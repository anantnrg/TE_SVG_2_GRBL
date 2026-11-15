#!/usr/bin/env bash
set -euo pipefail

if ! command -v emcmake >/dev/null 2>&1 || ! command -v em++ >/dev/null 2>&1; then
  echo "Activate the Emscripten SDK before building OpenCV WASM." >&2
  exit 1
fi

root="$(git rev-parse --show-toplevel)"
version=4.13.0
work="${TMPDIR:-/tmp}/te-svg-opencv-wasm-${version}"
opencv_source="${work}/opencv"
contrib_source="${work}/opencv_contrib"
build_dir="${work}/build"
output_dir="${root}/assets/wasm"

mkdir -p "$work" "$output_dir"
if [[ ! -d "${opencv_source}/.git" ]]; then
  git clone --depth 1 --branch "$version" https://github.com/opencv/opencv.git "$opencv_source"
fi
if [[ ! -d "${contrib_source}/.git" ]]; then
  git clone --depth 1 --branch "$version" https://github.com/opencv/opencv_contrib.git "$contrib_source"
fi

emcmake cmake -S "$opencv_source" -B "$build_dir" \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_CXX_STANDARD=17 \
  -DCMAKE_CXX_FLAGS="-msimd128 -fexceptions" \
  -DBUILD_LIST=core,imgproc,ximgproc \
  -DBUILD_SHARED_LIBS=OFF \
  -DBUILD_TESTS=OFF \
  -DBUILD_PERF_TESTS=OFF \
  -DBUILD_EXAMPLES=OFF \
  -DBUILD_opencv_apps=OFF \
  -DBUILD_opencv_js=OFF \
  -DBUILD_opencv_python3=OFF \
  -DBUILD_JAVA=OFF \
  -DWITH_OPENCL=OFF \
  -DWITH_IPP=OFF \
  -DWITH_TBB=OFF \
  -DWITH_ITT=OFF \
  -DWITH_PNG=OFF \
  -DWITH_JPEG=OFF \
  -DWITH_WEBP=OFF \
  -DWITH_OPENEXR=OFF \
  -DWITH_QUIRC=OFF \
  -DOPENCV_EXTRA_MODULES_PATH="${contrib_source}/modules"

cmake --build "$build_dir" --target opencv_ximgproc -j "${BUILD_JOBS:-2}"

em++ "${root}/tools/opencv-wasm/thinning.cpp" \
  -std=c++17 -O3 -msimd128 -fexceptions --bind \
  -I"${opencv_source}/modules/core/include" \
  -I"${opencv_source}/modules/imgproc/include" \
  -I"${opencv_source}/modules/flann/include" \
  -I"${opencv_source}/modules/features2d/include" \
  -I"${opencv_source}/modules/calib3d/include" \
  -I"${contrib_source}/modules/ximgproc/include" \
  -I"${build_dir}" \
  "${build_dir}/lib/libopencv_ximgproc.a" \
  "${build_dir}/lib/libopencv_imgproc.a" \
  "${build_dir}/lib/libopencv_core.a" \
  -sMODULARIZE=1 \
  -sEXPORT_ES6=1 \
  -sENVIRONMENT=web,worker \
  -sALLOW_MEMORY_GROWTH=1 \
  -sFILESYSTEM=0 \
  -sNO_EXIT_RUNTIME=1 \
  -o "${output_dir}/opencv-thinning.mjs"
