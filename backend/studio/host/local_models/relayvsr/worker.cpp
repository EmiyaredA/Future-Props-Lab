#include "stable-diffusion.h"

#include <algorithm>
#include <atomic>
#include <cctype>
#include <chrono>
#include <cstdlib>
#include <cstdio>
#include <fstream>
#include <iostream>
#include <memory>
#include <sstream>
#include <string>
#include <thread>
#include <vector>
#include <unistd.h>
#include <fcntl.h>
#include <sys/file.h>

namespace {
std::atomic_bool memory_error{false};

void log_message(sd_log_level_t, const char* message, void*) {
    std::fputs(message, stderr);
    std::string text(message);
    std::transform(text.begin(), text.end(), text.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    if (text.find("out of memory") != std::string::npos ||
        text.find("failed to allocate") != std::string::npos ||
        text.find("allocation failed") != std::string::npos) {
        memory_error = true;
    }
}

std::string enhance(video_upscaler_ctx_t* context, const std::string& request) {
    unsigned width = 0, height = 0;
    int count = 0, fps = 0;
    std::istringstream args(request);
    if (!(args >> width >> height >> count >> fps) || width < 16 || height < 16 ||
        width > 2048 || height > 2048 || count < 1 || count > 64 || fps < 1 || fps > 120) {
        return "invalid";
    }
    const size_t frame_bytes = static_cast<size_t>(width) * height * 3;
    std::vector<uint8_t> pixels(frame_bytes * count);
    std::ifstream source("input.rgb", std::ios::binary);
    if (!source.read(reinterpret_cast<char*>(pixels.data()), pixels.size())) return "input";
    std::vector<sd_image_t> frames;
    frames.reserve(count);
    for (int i = 0; i < count; ++i) {
        frames.push_back({width, height, 3, pixels.data() + i * frame_bytes});
    }
    sd_video_upscale_params_t params;
    sd_video_upscale_params_init(&params);
    params.frames = frames.data();
    params.frame_count = count;
    params.fps = fps;
    params.seed = 42;
    params.window_size = 16;
    sd_video_generation_result_t* raw = nullptr;
    memory_error = false;
    const bool ok = upscale_video(context, &params, &raw);
    const std::unique_ptr<sd_video_generation_result_t, decltype(&free_sd_video_generation_result)>
        result(raw, free_sd_video_generation_result);
    if (!ok || !result || result->frame_count != count) return memory_error ? "oom" : "inference";

    std::ofstream output("output.rgb", std::ios::binary | std::ios::trunc);
    for (int i = 0; i < count; ++i) {
        const auto& frame = result->frames[i];
        if (frame.width != width * 2 || frame.height != height * 2 ||
            frame.channel != 3 || !frame.data) return "output";
        output.write(reinterpret_cast<const char*>(frame.data), frame_bytes * 4);
    }
    output.close();
    return output ? "ok" : "output";
}
} // namespace

int main(int argc, char** argv) {
    if (argc == 2 && std::string(argv[1]) == "--version") {
        std::cout << sd_commit() << std::endl;
        return 0;
    }
    if (argc != 4) return 2;
    // Keep the protocol separate from native kernels that print directly to stdout.
    FILE* protocol = fdopen(dup(STDOUT_FILENO), "w");
    if (!protocol || dup2(STDERR_FILENO, STDOUT_FILENO) < 0) return 2;
    const auto reply = [protocol](const std::string& message) {
        std::fprintf(protocol, "%s\n", message.c_str());
        std::fflush(protocol);
    };
    const pid_t parent = getppid();
    if (parent == 1) return 2;
    // A crashed website cannot leave a detached GPU operation running.
    std::thread([parent] {
        while (getppid() == parent) std::this_thread::sleep_for(std::chrono::seconds(1));
        std::_Exit(6);
    }).detach();
    const int lock = open(argv[3], O_CREAT | O_RDWR | O_NOFOLLOW, 0600);
    if (lock < 0 || flock(lock, LOCK_EX | LOCK_NB) < 0) {
        reply("busy");
        return 5;
    }
    sd_set_log_callback(log_message, nullptr);
    const size_t size = sd_list_devices(nullptr, 0);
    std::vector<char> devices(size + 1, '\0');
    sd_list_devices(devices.data(), devices.size());
    std::string metal;
    std::istringstream listing(devices.data());
    for (std::string line; std::getline(listing, line);) {
        const auto name = line.substr(0, line.find('\t'));
        if (name.rfind("MTL", 0) == 0) {
            metal = name;
            break;
        }
    }
    if (metal.empty()) {
        reply("metal_unavailable");
        return 3;
    }
    sd_video_upscaler_ctx_params_t params;
    sd_video_upscaler_ctx_params_init(&params);
    params.diffusion_model_path = argv[1];
    params.vae_path = argv[2];
    params.backend = metal.c_str();
    params.params_backend = metal.c_str();
    params.upscale_factor = 2;
    const std::unique_ptr<video_upscaler_ctx_t, decltype(&free_video_upscaler_ctx)>
        context(new_video_upscaler_ctx(&params), free_video_upscaler_ctx);
    if (!context) {
        reply(memory_error ? "oom" : "load_failed");
        return 4;
    }
    reply("ready");
    for (std::string request; std::getline(std::cin, request);) {
        try {
            reply(enhance(context.get(), request));
        } catch (const std::bad_alloc&) {
            reply("oom");
        }
    }
}
