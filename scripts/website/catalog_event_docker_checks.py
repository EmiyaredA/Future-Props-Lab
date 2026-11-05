"""Exercise private Identity catalogue transport inside its actual isolated container."""

import json

from studio.contracts.model_service.catalog_events import CatalogEvents

CLIENT = """
import json
import sys
from urllib.error import HTTPError
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None

opener = build_opener(ProxyHandler({}), NoRedirect())

def call(method, path, headers, body=None):
    data = None if body is None else json.dumps(body).encode()
    request = Request('http://127.0.0.1:8080' + path, data=data, method=method,
                      headers={**headers, 'Content-Type': 'application/json'})
    try:
        response = opener.open(request, timeout=5)
    except HTTPError as error:
        response = error
    with response:
        return response.status, response.headers, response.read().decode()

tokens = json.load(sys.stdin)
path = '/_internal/v1/model-catalog/events'
for headers in ({}, {'Authorization': 'Bearer ' + tokens['agents']},
                {'Authorization': 'Bearer ' + tokens['models'], 'Origin': 'http://browser'}):
    assert call('GET', path, headers)[0] == 403
headers = {'Authorization': 'Bearer ' + tokens['models']}
status, response_headers, body = call('GET', path, headers)
assert status == 200 and response_headers['cache-control'] == 'no-store'
result = json.loads(body)
assert result['events']
event = result['events'][0]['event']
ack = path + '/' + event['id'] + '/ack'
assert call('POST', ack, headers, {'revision': event['revision'] + 1})[0] == 409
assert call('POST', ack, headers, {'revision': True})[0] == 422
print(json.dumps(result))
"""


def verify_private_catalog(compose, *, model_token, agent_token, owner):
    result = compose(
        "exec",
        "-T",
        "identity",
        "python",
        "-c",
        CLIENT,
        input_text=json.dumps({"models": model_token, "agents": agent_token}),
    )
    page = CatalogEvents.model_validate_json(result.stdout)
    assert any(delivery.account.user_id == owner for delivery in page.events)
    assert "password" not in result.stdout and "username" not in result.stdout
