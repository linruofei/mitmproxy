import typing

from .. import http
from ._utils import merge_repeated_keys
from ._utils import yaml_dumps
from mitmproxy.contentviews._api import Contentview
from mitmproxy.contentviews._api import Metadata


class QueryContentview(Contentview):
    syntax_highlight = "yaml"

    def prettify(
        self,
        data: bytes,
        metadata: Metadata,
    ) -> str:
        if not isinstance(metadata.http_message, http.Request):
            raise ValueError("Not an HTTP request.")
        items = metadata.http_message.query.items(multi=True)
        return yaml_dumps(merge_repeated_keys(items))

    def to_json(self, data: bytes, metadata: Metadata) -> typing.Any | None:
        if not isinstance(metadata.http_message, http.Request):
            return None
        return (
            merge_repeated_keys(metadata.http_message.query.items(multi=True)) or None
        )

    def render_priority(
        self,
        data: bytes,
        metadata: Metadata,
    ) -> float:
        return 0.3 * float(
            not data and bool(getattr(metadata.http_message, "query", False))
        )


query = QueryContentview()
