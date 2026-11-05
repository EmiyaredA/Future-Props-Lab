"""Real private library input exchange; only synthetic login/credentials use stdin."""

import base64
import io
import json
import wave

CLIENT = """
import base64
import json
import sys
from email.message import Message
from urllib.error import HTTPError
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None

opener = build_opener(ProxyHandler({}), NoRedirect())
data = json.load(sys.stdin)

def call(base, method, path, headers, body=None):
    payload = None if body is None else json.dumps(body).encode()
    request = Request(base + path, data=payload, method=method,
        headers={**headers, 'Content-Type': 'application/json'})
    try:
        response = opener.open(request, timeout=5)
    except HTTPError as error:
        response = error
    with response:
        return response.status, response.headers, response.read(65536)

identity = 'http://127.0.0.1:8080'
assets = 'http://assets:8080'
source = '/v1/model-inference/assets/import'
private = '/_internal/v1/model-library-inputs/' + data['asset_id']
headers = {
    'Host': data['host'], 'Origin': data['origin'], 'Cookie': data['cookie'],
    'X-CSRF-Token': data['csrf'], 'X-Fpl-Gateway': data['gateway'],
    'X-Fpl-Ingress': 'local', 'X-Fpl-Target-Service': 'models',
    'X-Fpl-Request-Method': 'POST', 'X-Fpl-Request-Uri': source,
}
status, response_headers, _ = call(identity, 'GET', '/_internal/v1/authorize', headers)
assert status == 204
body = {
    'caller': 'models', 'purpose': 'models.library-input.read',
    'source_method': 'POST', 'source_path': source,
    'target_service': 'assets', 'target_method': 'GET', 'target_path': private,
    'assertion': response_headers['X-Fpl-Context'],
}
assert call(identity, 'POST', '/_internal/v1/authorization/delegate',
    {'Authorization': 'Bearer ' + data['agents']}, body)[0] == 403
status, _, content = call(identity, 'POST', '/_internal/v1/authorization/delegate',
    {'Authorization': 'Bearer ' + data['models']}, body)
assert status == 200
token = json.loads(content)['assertion']
assert call(assets, 'GET', private, {})[0] == 401
assert call(assets, 'GET', private, {'X-Fpl-Context': token, 'Origin': data['origin']})[0] == 403
assert call(assets, 'GET', private + '-another', {'X-Fpl-Context': token})[0] == 401
status, headers, content = call(assets, 'GET', private, {'X-Fpl-Context': token})
assert status == 200 and content == base64.b64decode(data['content'])
assert headers['cache-control'] == 'no-store' and headers['X-Fpl-File-Kind'] == 'audio'
disposition = Message()
disposition['Content-Disposition'] = headers['Content-Disposition']
assert disposition.get_filename() == data['filename']
print('private model library inputs verified')
"""


def verify_model_library_inputs(
    client, unsafe, compose, *, gateway_token, model_token, agent_token
):
    content = io.BytesIO()
    with wave.open(content, "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(8000)
        output.writeframes(b"\0\0" * 800)
    filename = "模型输入验收.wav"
    response = client.post(
        "/v1/files",
        headers=unsafe,
        files={"upload": (filename, content.getvalue(), "audio/wav")},
    )
    assert response.status_code == 200, response.text
    asset = response.json()
    result = compose(
        "exec",
        "-T",
        "identity",
        "python",
        "-c",
        CLIENT,
        input_text=json.dumps(
            {
                "models": model_token,
                "agents": agent_token,
                "gateway": gateway_token,
                "asset_id": asset["id"],
                "filename": filename,
                "content": base64.b64encode(content.getvalue()).decode(),
                "host": client.base_url.netloc.decode(),
                "origin": str(client.base_url).rstrip("/"),
                "cookie": "; ".join(name + "=" + value for name, value in client.cookies.items()),
                "csrf": client.cookies.get("fpl_csrf"),
            }
        ),
    )
    assert result.stdout.strip() == "private model library inputs verified"
    private = "/_internal/v1/model-library-inputs/" + asset["id"]
    assert client.get(private).status_code == 404
    assert client.get("/files" + private).status_code == 404
    deleted = client.delete(
        "/v1/files/" + asset["id"] + "?expected_revision=" + str(asset["revision"]),
        headers=unsafe,
    )
    assert deleted.status_code == 200, deleted.text
    return (
        "Identity-to-Assets library input delegation is private, scoped and preserves Unicode bytes"
    )
