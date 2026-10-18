//! Now playing through SMTC (`GlobalSystemMediaTransportControlsSessionManager`), event driven: the
//! manager's `CurrentSessionChanged` / `SessionsChanged` re-pick the session, the session's
//! `MediaPropertiesChanged` / `PlaybackInfoChanged` / `TimelinePropertiesChanged` re-read it. No polling: the page
//! projects the position forward itself from `positionMs` + `positionAt`.
//!

#[cfg(windows)]
use notch_core::media::{self, Media, MediaAction};
#[cfg(windows)]
use windows::core::Result;
#[cfg(windows)]
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSession as Session, GlobalSystemMediaTransportControlsSessionManager as Manager,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus as Playback,
};

/// Windows FILETIME counts 100 ns ticks from 1601-01-01; this is how many of them precede the Unix epoch.
#[cfg(windows)]
const EPOCH_DIFF_TICKS: i64 = 116_444_736_000_000_000;

#[cfg(windows)]
fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64)
}

/// A playing session first; else the one Windows calls current.
#[cfg(windows)]
fn pick(manager: &Manager) -> Option<Session> {
    let playing = manager.GetSessions().ok().and_then(|all| {
        all.into_iter().find(|s| s.GetPlaybackInfo().and_then(|i| i.PlaybackStatus()).ok() == Some(Playback::Playing))
    });
    playing.or_else(|| manager.GetCurrentSession().ok())
}

/// The cover as a data URL; None if the player has none (yet) or it is over `MAX_ART_BYTES`.
#[cfg(windows)]
fn art(props: &windows::Media::Control::GlobalSystemMediaTransportControlsSessionMediaProperties) -> Option<String> {
    use base64::Engine;
    let stream = props.Thumbnail().ok()?.OpenReadAsync().ok()?.get().ok()?;
    let size = stream.Size().ok()?;
    if size == 0 || size > media::MAX_ART_BYTES as u64 {
        return None;
    }
    let mime = art_mime(stream.ContentType().map(|s| s.to_string()).unwrap_or_default());
    let bytes = read_all(&stream, size as u32)?;
    Some(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}

/// All `len` bytes of a WinRT stream, from the start.
#[cfg(windows)]
fn read_all(stream: &windows::Storage::Streams::IRandomAccessStreamWithContentType, len: u32) -> Option<Vec<u8>> {
    use windows::Storage::Streams::DataReader;
    let reader = DataReader::CreateDataReader(&stream.GetInputStreamAt(0).ok()?).ok()?;
    reader.LoadAsync(len).ok()?.get().ok()?;
    let mut bytes = vec![0u8; len as usize];
    reader.ReadBytes(&mut bytes).ok()?;
    Some(bytes)
}

/// Only image types go into a data URL the page puts in <img>.
#[cfg(windows)]
fn art_mime(mime: String) -> String {
    if mime.starts_with("image/") && mime.len() < 40 {
        mime
    } else {
        "image/png".into()
    }
}

/// SMTC reports 100 ns ticks (and a Windows-epoch update time); the page wants ms. Returns `(duration_ms, position_ms)`.
#[cfg(windows)]
fn timeline_ms(start: i64, end: i64, position: i64, last_updated_utc: i64, now: u64, playing: bool) -> (u64, u64) {
    let ticks = |t: i64| (t.max(0) / 10_000) as u64;
    let duration_ms = ticks(end - start);
    let updated = ticks(last_updated_utc - EPOCH_DIFF_TICKS);
    (duration_ms, media::project(ticks(position), updated, now, playing, duration_ms))
}

/// Remembers the last cover per track, so a timeline tick does not read the picture again.
#[cfg(windows)]
#[derive(Default)]
struct ArtCache {
    key: String,
    art: Option<String>,
}

#[cfg(windows)]
fn read(session: &Session, cache: &mut ArtCache) -> Result<Option<Media>> {
    let props = session.TryGetMediaPropertiesAsync()?.get()?;
    let title = props.Title()?.to_string();
    if title.is_empty() {
        return Ok(None);
    }
    let info = session.GetPlaybackInfo()?;
    let controls = info.Controls()?;
    let timeline = session.GetTimelineProperties()?;
    let playing = info.PlaybackStatus()? == Playback::Playing;
    let now = now_ms();
    let (duration_ms, position_ms) = timeline_ms(
        timeline.StartTime()?.Duration,
        timeline.EndTime()?.Duration,
        timeline.Position()?.Duration,
        timeline.LastUpdatedTime()?.UniversalTime,
        now,
        playing,
    );
    let app_id = session.SourceAppUserModelId()?.to_string();
    let (artist, album) = (props.Artist()?.to_string(), props.AlbumTitle()?.to_string());
    let key = [app_id.as_str(), title.as_str(), artist.as_str(), album.as_str()].join("
");
    if key != cache.key || cache.art.is_none() {
        // The cover frequently lands after the title; MediaPropertiesChanged fires again when it does, so retry.
        cache.art = art(&props);
        cache.key = key;
    }
    Ok(Some(Media {
        title,
        artist,
        album,
        app: media::app_name(&app_id),
        art: cache.art.clone(),
        playing,
        position_ms,
        position_at: now,
        duration_ms,
        can_next: controls.IsNextEnabled()?,
        can_previous: controls.IsPreviousEnabled()?,
        can_seek: controls.IsPlaybackPositionEnabled()? && duration_ms > 0,
    }))
}

#[cfg(windows)]
fn refresh<A: windows::core::RuntimeType + 'static>(
    tx: &std::sync::mpsc::Sender<Msg>,
) -> windows::Foundation::TypedEventHandler<Session, A> {
    let t = tx.clone();
    windows::Foundation::TypedEventHandler::new(move |_, _| {
        let _ = t.send(Msg::Refresh);
        Ok(())
    })
}

#[cfg(windows)]
enum Msg {
    /// The manager says the current session or the session list changed.
    Repick,
    /// The subscribed session's metadata, playback or timeline changed.
    Refresh,
}

/// Starts the watcher thread for the process's life; `sink` gets every change (None = nothing playing), and the
/// first state once at start.
#[cfg(windows)]
pub fn watch(sink: impl Fn(Option<Media>) + Send + 'static) {
    use windows::Foundation::TypedEventHandler;
    std::thread::spawn(move || {
        crate::com();
        let Ok(manager) = Manager::RequestAsync().and_then(|op| op.get()) else {
            eprintln!("[notch] no SMTC: music will not be shown");
            return;
        };
        let (tx, rx) = std::sync::mpsc::channel::<Msg>();
        let t = tx.clone();
        let _ = manager.CurrentSessionChanged(&TypedEventHandler::new(move |_, _| {
            let _ = t.send(Msg::Repick);
            Ok(())
        }));
        let t = tx.clone();
        let _ = manager.SessionsChanged(&TypedEventHandler::new(move |_, _| {
            let _ = t.send(Msg::Repick);
            Ok(())
        }));
        let mut current: Option<(Session, [i64; 3])> = None;
        let (mut cache, mut last): (ArtCache, Option<Option<Media>>) = (ArtCache::default(), None);
        let mut msg = Msg::Repick;
        loop {
            if let Msg::Repick = msg {
                if let Some((s, tokens)) = current.take() {
                    let _ = s.RemoveMediaPropertiesChanged(tokens[0]);
                    let _ = s.RemovePlaybackInfoChanged(tokens[1]);
                    let _ = s.RemoveTimelinePropertiesChanged(tokens[2]);
                }
                if let Some(s) = pick(&manager) {
                    let tokens = [
                        s.MediaPropertiesChanged(&refresh(&tx)).unwrap_or_default(),
                        s.PlaybackInfoChanged(&refresh(&tx)).unwrap_or_default(),
                        s.TimelinePropertiesChanged(&refresh(&tx)).unwrap_or_default(),
                    ];
                    current = Some((s, tokens));
                }
            }
            let now = current.as_ref().and_then(|(s, _)| read(s, &mut cache).ok().flatten());
            if last.as_ref() != Some(&now) {
                sink(now.clone());
                last = Some(now);
            }
            let Ok(next) = rx.recv() else { return };
            // A burst (a track change fires all three) is read once.
            msg = rx.try_iter().fold(next, |acc, m| if matches!(acc, Msg::Repick) { acc } else { m });
        }
    });
}

/// The page's play/pause, next, previous, seek on the session Notch shows. False = no session or the player said no.
#[cfg(windows)]
pub fn control(action: MediaAction, position_ms: Option<u64>) -> bool {
    crate::com();
    let run = || -> Result<bool> {
        let manager = Manager::RequestAsync()?.get()?;
        let Some(s) = pick(&manager) else { return Ok(false) };
        match action {
            MediaAction::PlayPause => s.TryTogglePlayPauseAsync()?.get(),
            MediaAction::Next => s.TrySkipNextAsync()?.get(),
            MediaAction::Previous => s.TrySkipPreviousAsync()?.get(),
            MediaAction::Seek => {
                let Some(ms) = position_ms else { return Ok(false) };
                let start = s.GetTimelineProperties()?.StartTime()?.Duration;
                s.TryChangePlaybackPositionAsync(start + (ms.min(i64::MAX as u64 / 20_000) as i64) * 10_000)?.get()
            }
        }
    };
    run().unwrap_or(false)
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    const SEC: i64 = 10_000_000; // ticks per second

    #[test]
    fn smtc_ticks_become_ms_and_the_position_runs_on_only_while_playing() {
        // 3:00 long track starting at tick 0, 10 s in, updated at unix 1000 s, now = unix 1003 s.
        let updated = EPOCH_DIFF_TICKS + 1000 * SEC;
        assert_eq!(timeline_ms(0, 180 * SEC, 10 * SEC, updated, 1_003_000, true), (180_000, 13_000));
        assert_eq!(
            timeline_ms(0, 180 * SEC, 10 * SEC, updated, 1_003_000, false),
            (180_000, 10_000),
            "paused: no run-on"
        );
        // a track that does not start at 0 (live/seek window): duration is end - start
        assert_eq!(timeline_ms(60 * SEC, 90 * SEC, 0, updated, 1_003_000, false).0, 30_000);
        // negative ticks never wrap; an end before the start is a zero-length (unknown) duration
        assert_eq!(timeline_ms(10 * SEC, 0, -5, 0, 5_000, true), (0, 0));
        // the run-on stops at the end
        assert_eq!(timeline_ms(0, 20 * SEC, 19 * SEC, updated, 1_010_000, true), (20_000, 20_000));
    }

    #[test]
    fn only_small_image_types_reach_the_data_url() {
        assert_eq!(art_mime("image/jpeg".into()), "image/jpeg");
        assert_eq!(art_mime("".into()), "image/png", "player gave no type");
        assert_eq!(art_mime("text/html".into()), "image/png", "never a non-image type into <img>");
        assert_eq!(art_mime(format!("image/{}", "x".repeat(40))), "image/png", "absurdly long type");
    }
}
