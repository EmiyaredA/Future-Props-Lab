<!-- docs: {"group": "sdk-runtime", "category": "sdk", "order": 6, "title": "流式事件与实时语音", "lead": "流式结果需要保持连接并及时消费；关闭连接不会自动发起另一次调用。", "evidence": ["sdk/python/src/future_props_lab", "sdk/python/operations.json"], "related": ["sdk-quickstart", "sdk-errors"]} -->

# 流式事件与实时语音

流式结果需要保持连接并及时消费；关闭连接不会自动发起另一次调用。

## 文本事件

```python
with client.inference.stream_text(body={
    "model_id": model_id,
    "messages": [{"role": "user", "text": "描述一片森林"}],
}) as events:
    for event in events:
        if event.type == "delta":
            print(event.text, end="", flush=True)
```

独立文本流包含 start、delta、done、error。done 携带完整结果；error 表示流已建立后的失败。其他工坊保留各自的供应商无关事件，StreamEvent 同时保留原事件字段。

异步调用先 await 获得事件流，再通过 async with 和 async for 消费。断流不会自动重连或补发消息。

## 实时语音

```python
# 先通过无 API Key 的 Session 客户端完成登录。
with client.realtime() as voice:
    voice.start(model_id=model_id, voice=voice_name, instructions="你是一位测试助手")
    voice.audio(pcm16_16khz_bytes)
    voice.commit_input()
    for event in voice:
        print(event.type)
        if event.type == "turn_done":
            voice.stop()
            break
```

输入为单声道 PCM16、16 kHz；输出按平台现有协议为 PCM16、24 kHz。客户端负责采集与播放，SDK 负责协议收发。使用 interrupt、mute、stop 控制通话，实时语音仍用于模型测试。
