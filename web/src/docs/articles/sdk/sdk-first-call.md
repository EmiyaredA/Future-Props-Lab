<!-- docs: {"category": "sdk", "group": "sdk-start", "order": 3, "title": "首次创建演示文稿", "lead": "从可执行 SDK 样例提取的同步与异步调用。", "evidence": ["sdk/python/src/future_props_lab/examples.py", "tests/test_python_sdk.py"], "prerequisites": "已安装 SDK，并持有当前工作区的 content.write 权限。", "related": ["sdk-quickstart", "sdk-editing", "sdk-reference-presentation"], "examples": {"sync": "from future_props_lab.builders import presentation_document\n\ndef create_deck(client):\n    return client.presentation.create_project(\n        body={\n            \"title\": \"由 Python 创建的文稿\",\n            \"document\": presentation_document(),\n        }\n    )", "async": "from future_props_lab.builders import presentation_document\n\nasync def create_deck_async(client):\n    return await client.presentation.create_project(\n        body={\n            \"title\": \"由 Python 创建的文稿\",\n            \"document\": presentation_document(),\n        }\n    )", "curl": "curl -X POST \"$FPL_URL/v1/presentation-workshop/projects\" \\\n  -H \"Authorization: Bearer $FPL_API_KEY\" -H \"Content-Type: application/json\" \\\n  --data-binary @presentation.json"}} -->

# 首次创建演示文稿

## 准备客户端

按安装与认证教程创建 Client 或 AsyncClient，再将客户端传给下方函数。cURL 的 presentation.json 包含相同 title 和 document 请求体。

## 查看结果

返回的 id 可在网页演示工坊中打开；后续编辑从返回的 revision 开始。
