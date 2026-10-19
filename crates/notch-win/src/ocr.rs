//! Clipboard OCR: the text in a PNG through `Windows.Media.Ocr`, on this PC, in the user's profile languages.
//! Blocking (WinRT `.get()`): call it off the UI thread.

/// `Ok("")` = no text found; `Err` = OCR unavailable (no OCR language installed) or the PNG did not decode.
#[cfg(windows)]
pub fn text(png: &[u8]) -> Result<String, ()> {
    use windows::Graphics::Imaging::{BitmapPixelFormat, SoftwareBitmap};
    use windows::Media::Ocr::OcrEngine;
    use windows::Storage::Streams::DataWriter;

    let engine = OcrEngine::TryCreateFromUserProfileLanguages().map_err(|_| ())?;
    let max = OcrEngine::MaxImageDimension().unwrap_or(2600);
    let pic = crate::clip_image::thumbnail(&crate::clip_image::decode_png(png).ok_or(())?, max);
    let bgra: Vec<u8> = pic.rgba.chunks_exact(4).flat_map(|p| [p[2], p[1], p[0], p[3]]).collect();
    let run = || -> windows::core::Result<String> {
        let w = DataWriter::new()?;
        w.WriteBytes(&bgra)?;
        let bmp = SoftwareBitmap::CreateCopyFromBuffer(&w.DetachBuffer()?, BitmapPixelFormat::Bgra8, pic.width as i32, pic.height as i32)?;
        let lines = engine.RecognizeAsync(&bmp)?.get()?.Lines()?;
        Ok(lines.into_iter().filter_map(|l| l.Text().ok()).map(|t| t.to_string()).collect::<Vec<_>>().join("\n"))
    };
    run().map(|t| t.trim().to_string()).map_err(|_| ())
}

#[cfg(not(windows))]
pub fn text(_png: &[u8]) -> Result<String, ()> {
    Err(())
}

#[cfg(all(test, windows))]
mod tests {
    // Needs an OCR language on the machine (en-US ships with Windows); ignored so CI never depends on it.
    #[test]
    #[ignore = "needs a Windows OCR language"]
    fn reads_the_fixture_and_finds_nothing_in_blank() {
        let t = super::text(include_bytes!("../tests/fixtures/ocr-text.png")).unwrap();
        assert!(t.contains("Peeka") && t.contains("42"), "{t}");
        let blank = crate::clip_image::encode_png(&crate::clip_image::Picture { width: 64, height: 64, rgba: vec![255; 64 * 64 * 4] }).unwrap();
        assert_eq!(super::text(&blank), Ok(String::new()));
    }
}
