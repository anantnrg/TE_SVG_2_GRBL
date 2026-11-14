use serde::Deserialize;
use vtracer::{ColorImage, Config};
use wasm_bindgen::prelude::*;

#[derive(Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct Options {
    clustering: Option<String>,
    hierarchical: Option<String>,
    mode: Option<String>,
    filter_speckle: Option<usize>,
    simplify: Option<f64>,
    binary_threshold: Option<u8>,
    adaptive: Option<bool>,
    adaptive_window: Option<u32>,
    adaptive_t: Option<f64>,
    max_colors: Option<usize>,
    color_precision: Option<i32>,
}

fn js_error(error: impl std::fmt::Display) -> JsValue {
    JsValue::from_str(&error.to_string())
}

fn make_config(options: JsValue) -> Result<Config, JsValue> {
    let options: Options = if options.is_undefined() || options.is_null() {
        Options::default()
    } else {
        serde_wasm_bindgen::from_value(options).map_err(js_error)?
    };
    let mut config = Config::default();
    if let Some(value) = options.clustering {
        config.clustering = value.parse().map_err(js_error)?;
    }
    if let Some(value) = options.hierarchical {
        config.hierarchical = value.parse().map_err(js_error)?;
    }
    if let Some(value) = options.mode {
        config.mode = value.parse().map_err(js_error)?;
    }
    if let Some(value) = options.filter_speckle {
        config.filter_speckle = value;
    }
    if let Some(value) = options.simplify {
        config.simplify = Some(value);
    }
    if let Some(value) = options.binary_threshold {
        config.binary_threshold = value;
    }
    if let Some(value) = options.max_colors {
        config.max_colors = Some(value);
    }
    if let Some(value) = options.color_precision {
        config.color_precision = value;
    }
    if options.adaptive == Some(true)
        || options.adaptive_window.is_some()
        || options.adaptive_t.is_some()
    {
        config.binary_adaptive = true;
    }
    if let Some(value) = options.adaptive_window {
        config.binary_adaptive_window = value;
    }
    if let Some(value) = options.adaptive_t {
        config.binary_adaptive_t = value;
    }
    Ok(config)
}

#[wasm_bindgen]
pub fn vectorize_rgba(
    pixels: Vec<u8>,
    width: usize,
    height: usize,
    options: JsValue,
) -> Result<String, JsValue> {
    let pixel_count = width
        .checked_mul(height)
        .ok_or_else(|| js_error("Image dimensions are too large."))?;
    let expected_length = pixel_count
        .checked_mul(4)
        .ok_or_else(|| js_error("Image dimensions are too large."))?;
    if width == 0 || height == 0 || pixel_count > 4_000_000 || pixels.len() != expected_length {
        return Err(js_error("Image dimensions or pixel data are not supported."));
    }

    let config = make_config(options)?;
    config
        .build()
        .map_err(js_error)?
        .to_svg(&ColorImage {
            pixels,
            width,
            height,
        })
        .map_err(js_error)
}
