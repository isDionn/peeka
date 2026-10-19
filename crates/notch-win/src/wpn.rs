//! The notification mirror's no-setup source (rules: `notch_core::mirror`): this user's own Windows notification
//! history database (`%LOCALAPPDATA%\Microsoft\Windows\Notifications\wpndatabase.db`), opened read-only on every
//! poll and closed right after. Windows keeps it in WAL mode; a read-only SQLite connection reads the WAL too, so no
//! copy is made and nothing is written. Layout (public forensic write-ups, checked on Windows 11 26100):
//! `Notification(Id, HandlerId, Type, Payload, ExpiryTime, ArrivalTime, …)` joined to
//! `NotificationHandler(RecordId, PrimaryId = the sender's AUMID, …)`. Any error (missing file, other layout, busy)
//! is `None`: the mirror shows "unavailable" or skips one poll. Rows are handed back and kept nowhere here.

use std::path::{Path, PathBuf};

use rusqlite::{Connection, OpenFlags};

/// One toast row: Windows's id, arrival time (FILETIME), the toast XML and the sender's AUMID ("" = unknown).
pub struct Row {
    pub id: u32,
    pub at: i64,
    pub payload: Vec<u8>,
    pub aumid: String,
}

/// Where this user's database is (None without `LOCALAPPDATA`).
pub fn path() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA").map(|d| PathBuf::from(d).join(r"Microsoft\Windows\Notifications\wpndatabase.db"))
}

/// Read-only: SQLite never writes the file through this connection. A short wait, then the poll is skipped.
pub fn open(path: &Path) -> Option<Connection> {
    if !path.is_file() {
        return None; // read-only open would fail anyway; never create one
    }
    let c = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX).ok()?;
    c.busy_timeout(std::time::Duration::from_millis(200)).ok()?;
    Some(c)
}

/// The newest `MAX_ROWS` toasts that have not expired (`now`: FILETIME, 100 ns since 1601). Badges and tiles are
/// skipped. None when the query fails (another Windows layout).
pub fn rows(c: &Connection, now: i64) -> Option<Vec<Row>> {
    let mut q = c
        .prepare(
            "SELECT n.Id, n.ArrivalTime, n.Payload, h.PrimaryId FROM Notification n \
             LEFT JOIN NotificationHandler h ON h.RecordId = n.HandlerId \
             WHERE n.Type = 'toast' AND (n.ExpiryTime IS NULL OR n.ExpiryTime <= 0 OR n.ExpiryTime > ?1) \
             ORDER BY n.ArrivalTime DESC LIMIT ?2",
        )
        .ok()?;
    let rows = q
        .query_map((now, notch_core::mirror::MAX_ROWS as i64), |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, Option<i64>>(1)?, r.get::<_, Option<Vec<u8>>>(2)?, r.get::<_, Option<String>>(3)?))
        })
        .ok()?;
    let mut out = Vec::new();
    for r in rows {
        let (id, at, payload, aumid) = r.ok()?;
        let Ok(id) = u32::try_from(id) else { continue };
        out.push(Row { id, at: at.unwrap_or(0), payload: payload.unwrap_or_default(), aumid: aumid.unwrap_or_default() });
    }
    Some(out)
}

/// Unix ms -> FILETIME.
pub fn filetime(unix_ms: u64) -> i64 {
    (unix_ms as i64 + 11_644_473_600_000) * 10_000
}

pub fn now() -> i64 {
    filetime(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64))
}

/// The database exists and has the layout this file reads.
pub fn readable() -> bool {
    path().and_then(|p| open(&p)).is_some_and(|c| rows(&c, now()).is_some())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The two tables as Windows 11 26100 creates them (copied from `sqlite_master`).
    const SCHEMA: &str = "
        CREATE TABLE [NotificationHandler] ( [RecordId] INTEGER PRIMARY KEY, [PrimaryId] TEXT NOT NULL COLLATE NOCASE, [WNSId] TEXT COLLATE NOCASE, [HandlerType] TEXT, [WNFEventName] INT64, [SystemDataPropertySet] BLOB, [CreatedTime] DATETIME, [ModifiedTime] DATETIME, [ParentId] TEXT COLLATE NOCASE, [ContainerSid] TEXT COLLATE NOCASE);
        CREATE TABLE [Notification]( [Order] INTEGER NOT NULL PRIMARY KEY, [Id] INTEGER NOT NULL, [HandlerId] INTEGER CONSTRAINT[NotificationToHandler] REFERENCES[NotificationHandler]([RecordId]) ON DELETE CASCADE ON UPDATE CASCADE, [ActivityId] GUID,[Type] TEXT NOT NULL, [Payload] BLOB, [Tag] TEXT, [Group] TEXT, [ExpiryTime] INT64, [ArrivalTime] INT64, [DataVersion] INT64 DEFAULT '0', [PayloadType] TEXT NOT NULL, [BootId] INT64 DEFAULT '0', [ExpiresOnReboot] BOOLEAN DEFAULT 'FALSE', UNIQUE([Id]) ON CONFLICT REPLACE);";

    struct Fixture(PathBuf);
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(self.0.parent().unwrap());
        }
    }

    /// A WAL database like Windows's; the writer stays open so the rows live in the WAL, as they do on a real PC.
    fn fixture(name: &str, schema: &str) -> (Fixture, Connection) {
        let dir = std::env::temp_dir().join(format!("peeka-wpn-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("wpndatabase.db");
        let w = Connection::open(&path).unwrap();
        w.pragma_update(None, "journal_mode", "wal").unwrap();
        w.pragma_update(None, "wal_autocheckpoint", 0).unwrap();
        w.pragma_update(None, "foreign_keys", false).unwrap(); // a toast whose handler is gone is a test case
        w.execute_batch(schema).unwrap();
        (Fixture(path), w)
    }

    fn toast(w: &Connection, id: i64, handler: i64, ty: &str, at: i64, expiry: i64, text: &str) {
        let xml = format!(r#"<toast><visual><binding template="ToastGeneric"><text>{text}</text></binding></visual></toast>"#);
        w.execute(
            "INSERT INTO Notification (Id, HandlerId, Type, Payload, ExpiryTime, ArrivalTime, PayloadType) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'Xml')",
            (id, handler, ty, xml.into_bytes(), expiry, at),
        )
        .unwrap();
    }

    #[test]
    fn reads_live_toasts_newest_first_with_the_sender_and_writes_nothing() {
        let (f, w) = fixture("live", SCHEMA);
        w.execute_batch(
            "INSERT INTO NotificationHandler (RecordId, PrimaryId, HandlerType) VALUES (1, 'Claude_pzs8sxrjxfjjc!Claude', 'app:immersive'), (2, 'Microsoft.Office.OUTLOOK.EXE.15', 'app:desktop');",
        )
        .unwrap();
        let now = filetime(1_700_000_000_000);
        toast(&w, 10, 1, "toast", now - 2, 0, "Claude is done");
        toast(&w, 11, 2, "toast", now - 1, now + 1_000, "Mail");
        toast(&w, 12, 2, "toast", now - 3, now - 1, "expired");
        toast(&w, 13, 2, "tile", now, 0, "a tile");
        toast(&w, 14, 9, "toast", now - 4, 0, "no handler");
        toast(&w, 1 << 40, 1, "toast", now - 5, 0, "id too big");
        let before = std::fs::read(&f.0).unwrap();

        let c = open(&f.0).unwrap();
        let got = rows(&c, now).unwrap();
        let ids: Vec<u32> = got.iter().map(|r| r.id).collect();
        assert_eq!(ids, [11, 10, 14], "newest first; expired, tile and oversized id skipped");
        assert_eq!(got[1].aumid, "Claude_pzs8sxrjxfjjc!Claude");
        assert_eq!(got[2].aumid, "", "a toast whose handler is gone keeps its text");
        assert_eq!(notch_core::mirror::toast_texts(&got[1].payload), ["Claude is done"]);
        assert!(c.execute("DELETE FROM Notification", ()).is_err(), "the connection cannot write");
        drop(c);
        assert_eq!(std::fs::read(&f.0).unwrap(), before, "the main file is untouched");
        drop(w);
    }

    #[test]
    fn the_newest_rows_only() {
        let (f, w) = fixture("cap", SCHEMA);
        for i in 0..(notch_core::mirror::MAX_ROWS as i64 + 10) {
            toast(&w, i, 1, "toast", i, 0, "x");
        }
        let got = rows(&open(&f.0).unwrap(), 0).unwrap();
        assert_eq!(got.len(), notch_core::mirror::MAX_ROWS);
        assert_eq!(got[0].id as usize, notch_core::mirror::MAX_ROWS + 9);
    }

    #[test]
    fn another_layout_or_no_file_fails_softly() {
        let (f, _w) = fixture("other", "CREATE TABLE Notification (Id INTEGER, Kind TEXT);");
        assert!(rows(&open(&f.0).unwrap(), 0).is_none(), "missing columns: None, no panic");
        let missing = f.0.with_file_name("nope.db");
        assert!(open(&missing).is_none());
        assert!(!missing.exists(), "a missing database is never created");
        assert_eq!(filetime(0), 116_444_736_000_000_000);
    }

    /// This PC's real database opens and has the expected layout (`cargo test -p notch-win --lib -- --ignored wpn`).
    /// Reads row ids only; nothing is printed.
    #[test]
    #[ignore = "reads this PC's notification history"]
    fn this_pcs_database_is_readable() {
        assert!(readable());
    }
}
