#include <emscripten/bind.h>
#include <opencv2/core.hpp>
#include <opencv2/ximgproc.hpp>

#include <cstdint>
#include <vector>

namespace {

emscripten::val thin(
    const emscripten::val& pixels,
    int width,
    int height,
    int algorithm
) {
    if (width <= 0 || height <= 0 || (algorithm != 0 && algorithm != 1)) {
        emscripten::val result = emscripten::val::object();
        result.set("error", "Invalid image dimensions or thinning algorithm.");
        return result;
    }

    const auto pixel_count = static_cast<std::size_t>(width) * height;
    if (pixel_count > 4'000'000 || pixels["length"].as<std::size_t>() != pixel_count) {
        emscripten::val result = emscripten::val::object();
        result.set("error", "Binary image data does not match its dimensions.");
        return result;
    }

    std::vector<std::uint8_t> input(pixel_count);
    for (std::size_t index = 0; index < pixel_count; ++index) {
        input[index] = pixels[index].as<std::uint8_t>() == 0 ? 0 : 255;
    }

    const cv::Mat source(height, width, CV_8UC1, input.data());
    cv::Mat skeleton;
    cv::ximgproc::thinning(source, skeleton, algorithm);

    emscripten::val result = emscripten::val::object();
    result.set("pixels", emscripten::val(
        emscripten::typed_memory_view(skeleton.total(), skeleton.data)
    ).call<emscripten::val>("slice"));
    return result;
}

}

EMSCRIPTEN_BINDINGS(opencv_thinning) {
    emscripten::function("thin", &thin);
}
