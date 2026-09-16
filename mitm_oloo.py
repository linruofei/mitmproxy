from mitmproxy import flow
from mitmproxy import http
from mitmproxy import ctx
from mitmproxy import user_variables
from mitmproxy.contentviews import Contentview, InteractiveContentview, Metadata, SyntaxHighlight, add
from cryptography.hazmat.backends import default_backend
from urllib.parse import urlparse, parse_qs, unquote, urlencode, parse_qsl
import base64, re, json, typing
import hashlib
import time
from Crypto.Cipher import AES
from Crypto.Util.Padding import unpad, pad
import os

app_aes_key_dcit = user_variables.DynamicDictProxy("app_aes_key_dict")
app_sign_key_dict = user_variables.DynamicDictProxy("app_sign_key_dict")
# 域名对应的APP名称
app_host_dict = user_variables.DynamicDictProxy("app_host_dict")
# app 列表
app_list = user_variables.DynamicDictProxy("app_list")
# 公参列表
public_params = user_variables.DynamicDictProxy("public_params")

data_mock_config = {
    # '/room/box/queryRoomBoxInfo': '/root/script/queryRoomBoxInfo.json',
}

class OlooData:


    @classmethod
    def get_sign_key(cls, app_name: str, params: dict = None) -> str:
        """
        根据系统(os)和版本号(appVersion)从 app_sign_key_dict 取签名密钥。
        未精确匹配版本时自动回退并给出明确告警提示。
        """
        if not isinstance(params, dict):
            return ''
        os_type = str(params.get('os', '')).strip().lower()
        app_version = str(params.get('appVersion', '')).strip()

        # 直接从 app_sign_key_dict 字典获取
        app_dict = app_sign_key_dict.get(app_name)
        if not app_dict or not isinstance(app_dict, dict):
            print(f"[OlooData.get_sign_key] [!] 未在配置中找到 app [{app_name}] 的密钥！配置仅含: {list(app_sign_key_dict.keys())}")
            return ''

        os_dict = app_dict.get(os_type)
        if not os_dict or not isinstance(os_dict, dict):
            print(f"[OlooData.get_sign_key] [!] 未在配置中找到系统 [{os_type}]！已配置系统: {list(app_dict.keys())}")
            return ''

        # 1. 精确匹配版本号
        key = str(os_dict.get(app_version, '')).strip()
        if key:
            return key

        # 2. 未精确匹配时的友好回退，防止由于版本号微调导致不计算签名
        available_versions = list(os_dict.keys())
        print(f"[OlooData.get_sign_key] [!] 提示: 当前请求版本 [{app_version}] 未在配置中定义，已配置版本: {available_versions}")
        if available_versions:
            fallback_ver = available_versions[-1]
            fallback_key = str(os_dict[fallback_ver]).strip()
            print(f"[OlooData.get_sign_key] [->] 自动回退使用版本 [{fallback_ver}] 的密钥计算签名")
            return fallback_key

        return ''

    @staticmethod
    def generate_sign(params: dict, sign_key: str) -> str:
        """
        生成签名

        :param params: 请求参数 dict
        :param sign_key: 签名密钥
        :return: 7位签名字符串
        """
        if not sign_key:
            print(f"[OlooData.generate_sign] [!] sign_key 为空，跳过签名生成！")
            return ""

        # 1. 参数排序（按 key 字典序）
        sorted_params = dict(sorted(params.items()))

        # 2. 移除 sn
        sorted_params.pop("sn", None)

        # 3. 拼接字符串
        pre_sign = []
        for k, v in sorted_params.items():
            pre_sign.append(f"{k}={v}")
        pre_sign.append(sign_key)

        pre_sign_str = "".join(pre_sign)

        # 4. MD5 加密（32位小写）
        md5_hash = hashlib.md5(pre_sign_str.encode("utf-8")).hexdigest()
        sn = md5_hash[:7]
        print(f"[OlooData.generate_sign] 待签名字串: {pre_sign_str}")
        print(f"[OlooData.generate_sign] MD5 散列: {md5_hash} -> 最终 sn: {sn}")

        # 5. 取前 7 位
        return sn

    @classmethod
    def sign_params(cls, params: dict, app_name: str = None, sign_key: str = None) -> dict:
        """
        根据当前请求参数直接计算 sn 签名
        """
        if not isinstance(params, dict):
            return params
        if not sign_key and app_name:
            sign_key = cls.get_sign_key(app_name, params)
        if sign_key:
            params['sn'] = cls.generate_sign(params, sign_key)
        else:
            print(f"[OlooData.sign_params] [!] 未获取到有效 sign_key，保持原有 sn={params.get('sn')} 不变")
        return params

    @classmethod
    def resign_and_reencrypt_request(cls, flow: http.HTTPFlow, new_data: dict) -> None:
        """
        辅助函数：供 request 钩子直接修改参数并重新签名、加密写回
        """
        host = flow.request.host_header
        app_name = app_host_dict.get(host)
        aes_cfg = app_aes_key_dcit.get(app_name)
        if not app_name or not aes_cfg:
            return
        cls.sign_params(new_data, app_name=app_name)

        if 'data' in flow.request.query:
            plain_query = urlencode(new_data)
            cipher = cls.aes_cbc_encrypt(plain_query, **aes_cfg)
            flow.request.query['data'] = cipher
        elif 'data' in flow.request.urlencoded_form:
            plain_form = urlencode(new_data)
            cipher = cls.aes_cbc_encrypt(plain_form, **aes_cfg)
            flow.request.urlencoded_form['data'] = cipher
        else:
            flow.request.set_text(json.dumps(new_data, ensure_ascii=False))

    @staticmethod
    def reorder_json_keys(data: dict, tail_keys: list[str] = [], remove_tail: bool = False) -> dict:
        """
        重新排序字典的键，将指定键放最后

        :param data: 字典数据
        :param tail_keys: 放最后键的列表
        :return: 重新排序的字典数据
        """
        sort_data = {}

        # 先放非 tail_keys
        for k, v in data.items():
            if k not in tail_keys:
                sort_data[k] = v

        if not remove_tail:
            # 再按指定顺序放 tail_keys
            for k in tail_keys:
                if k in data:
                    sort_data[k] = data[k]

        return sort_data

    @staticmethod
    def aes_cbc_decrypt(cipher_text: str, key: str, iv: str, **kwargs) -> str:
        """
        AES-CBC 解密（PKCS7）

        :param cipher_text: 密文（Base64 编码）
        :param key: 密钥（16/24/32 字节）
        :param iv: 偏移量（16 字节）
        :return: 明文字符串
        """
        key_bytes = key.encode("utf-8")
        iv_bytes = iv.encode("utf-8")

        cipher_data = base64.b64decode(cipher_text)

        cipher = AES.new(key_bytes, AES.MODE_CBC, iv_bytes)
        plain_bytes = unpad(cipher.decrypt(cipher_data), AES.block_size)

        return plain_bytes.decode("utf-8")

    @staticmethod
    def aes_cbc_encrypt(plain_text: str, key: str, iv: str, **kwargs) -> str:
        """
        AES-CBC 加密（PKCS7）

        :param plain_text: 明文字符串
        :param key: 密钥（16/24/32 字节）
        :param iv: 偏移量（16 字节）
        :return: Base64 编码的密文
        """
        key_bytes = key.encode("utf-8")
        iv_bytes = iv.encode("utf-8")

        plain_bytes = plain_text.encode("utf-8")
        padded_plain = pad(plain_bytes, AES.block_size)

        cipher = AES.new(key_bytes, AES.MODE_CBC, iv_bytes)
        cipher_bytes = cipher.encrypt(padded_plain)

        return base64.b64encode(cipher_bytes).decode("utf-8")

    
    @classmethod
    def get_decrypt_data(cls, flow: http.HTTPFlow, remove_pm=False) -> dict:
        """
        处理get请求数据
        
        :param flow: HTTPFlow 对象
        :param remove_pm: 是否去除公共参数
        :return: 处理后的数据字典
        """
        url_params = dict(flow.request.query)
        if 'data' in url_params and len(url_params) == 1:
            app_name = app_host_dict.get(flow.request.host_header)
            aes_cfg = app_aes_key_dcit.get(app_name)
            if not aes_cfg:
                return None
            try:
                url_params_str = unquote(url_params['data'])
                url_params_str = cls.aes_cbc_decrypt(url_params_str, **aes_cfg)
                url_params_dict = dict(parse_qsl(url_params_str))
                decrypt_dict = cls.reorder_json_keys(url_params_dict, public_params, remove_pm)
            except Exception as e:
                print(f"[OlooData] [!] GET 请求解密失败 ({flow.request.path}): {e}")
                decrypt_dict = None
        else:
            decrypt_dict = None
        
        return decrypt_dict

    # 处理post请求表单数据
    @classmethod
    def from_decrypt_data(cls, flow: http.HTTPFlow, remove_pm=False):
        form_data = dict(flow.request.urlencoded_form)
        if 'data' in form_data and len(form_data) == 1:
            app_name = app_host_dict.get(flow.request.host_header)
            aes_cfg = app_aes_key_dcit.get(app_name)
            if not aes_cfg:
                return None
            try:
                form_data_str = cls.aes_cbc_decrypt(form_data['data'], **aes_cfg)
                form_data_dict = dict(parse_qsl(form_data_str))
                decrypt_dict = cls.reorder_json_keys(form_data_dict, public_params, remove_pm)
            except Exception as e:
                print(f"[OlooData] [!] 表单解密失败 ({flow.request.path}): {e}")
                decrypt_dict = None
        else:
            decrypt_dict = None
        return decrypt_dict

    @classmethod
    def json_decrypt_data(cls, flow: http.HTTPFlow, remove_pm=False) -> dict:
        """
        处理json请求数据

        :param flow: HTTPFlow 对象
        :param remove_pm: 是否去除公共参数
        :return: 处理后的数据字典
        """
        try:
            content = flow.request.content.decode('utf-8') if flow.request.content else ''
            if content.strip():
                raw_dict = flow.request.json()
                if isinstance(raw_dict, dict):
                    decrypt_dict = cls.reorder_json_keys(raw_dict, public_params, remove_pm)
                else:
                    decrypt_dict = raw_dict
            else:
                decrypt_dict = cls.get_decrypt_data(flow, remove_pm)
        except Exception:
            decrypt_dict = cls.get_decrypt_data(flow, remove_pm)
        return decrypt_dict

    @classmethod
    def decrypt_data(cls, flow: http.HTTPFlow, remove_pm=False) -> dict:
        """
        处理请求数据

        :param flow: HTTPFlow 对象
        :param remove_pm: 是否去除公共参数
        :return: 处理后的数据字典
        """
        if flow.request.url.endswith(('.png', 'css', 'js', '/', 'ico', '.jpg', '.jpeg', '.gif', '.svga', 'mp4', '.mp3')):
            return None
        if 'data' in flow.request.query:
            decrypt_dict = cls.get_decrypt_data(flow, remove_pm)
        elif 'data' in flow.request.urlencoded_form:
            decrypt_dict = cls.from_decrypt_data(flow, remove_pm)
        else:
            decrypt_dict = cls.json_decrypt_data(flow, remove_pm)
        return decrypt_dict


rsp_header = {
    "Content-Type": "application/json;charset=UTF-8",
    "Access-Control-Allow-Origin": "*"
}


def mock_data(flow: http.HTTPFlow):
    """模拟响应数据"""
    mock_info = data_mock_config.get(urlparse(flow.request.url).path, None)
    if mock_info and flow.request.method in ['POST', 'GET']:
        with open(mock_info, 'r', encoding='utf-8') as f:
            mock_file_data = f.read()
        app_name = app_host_dict.get(flow.request.host_header)
        aes_cfg = OlooData.get_aes_config(app_name)
        if aes_cfg:
            mock_file_data = OlooData.aes_cbc_encrypt(mock_file_data, **aes_cfg)
            flow.response = http.Response.make(200, mock_file_data, rsp_header)
            print(f'{flow.request.path} 模拟了本地数据')


class RequestData:

    # 自定义列
    def load(self, loader):
        loader.add_option(
            name = "web_columns",
            typespec=typing.Sequence[str],
            default=['method', 'path', 'comment', 'status', 'size', 'time'],
            help="use custom columns",
        )

    def request(self, flow: http.HTTPFlow) -> None:
        """请求数据处理"""
        host = flow.request.host_header
        app_name = app_host_dict.get(host)
        if app_name in app_list:
            # 检测是否为 replay 重复请求
            if getattr(flow, "is_replay", False):
                # 重新解密完整参数（保留公共参数）
                decrypt_data = OlooData.decrypt_data(flow, remove_pm=False)
                if decrypt_data and isinstance(decrypt_data, dict):
                    print(f"\n[Replay] 检测到重复请求: {flow.request.url}")
                    old_sn = decrypt_data.get('sn')

                    # 1. 尝试使用当前参数预计算签名
                    calc_params = dict(decrypt_data)
                    OlooData.sign_params(calc_params, app_name=app_name)
                    expected_sn = calc_params.get('sn')

                    # 2. 如果参数完全一致（包含 sn 经计算后与当前完全一致），说明未修改参数，跳过重签与重新加密
                    if old_sn and expected_sn and old_sn == expected_sn:
                        print(f"[Replay] [=] 请求参数未变更，签名一致(sn={old_sn})，跳过重新签名与加密")
                    else:
                        # 参数发生变更，更新签名并重新加密写回请求中
                        OlooData.resign_and_reencrypt_request(flow, decrypt_data)
                        new_sn = decrypt_data.get('sn')
                        print(f"[Replay] [!] 检测到参数变更，自动完成重签加密: 原sn={old_sn} -> 新sn={new_sn}")

            # 将请求参数添加到comment中
            decrypt_data = OlooData.decrypt_data(flow, True)
            flow.comment = json.dumps(decrypt_data, indent=4, ensure_ascii=False) if decrypt_data else ''

        # mock_data(flow)

        # # 去除url中的参数
        # request_url = urlparse(flow.request.url).path
        # # 修改请求数据
        # if request_url == '/user/info/query':
        #     pass
            # # 修改url的参数
            # url_params = dict(flow.request.query)
            # url_params['queryUid'] = 10358
            # flow.request.query.update(url_params)

            # 修改POST请求的表单数据
            # form_data = dict(flow.request.urlencoded_form)
            # flow.request.urlencoded_form.update(form_data)

            # # 修改当前请求的json数据
            # flow.request.headers['token'] = '123=='
            # request_data = flow.request.json()
            # request_data['pageSize'] = 500
            # flow.request.set_text(
            #     json.dumps(request_data, ensure_ascii=False)
            # )

            # # 直接响应模拟数据
            # rsp_data = {
            #     "code": 7896,
            #     "msg": "上传失败",
            #     "data": "https://img.danachatapp.com/file/b00fdf04-cbec-44a4-849d-ef3eeffc68d8_1756967523531.jpg",
            #     "traceId": None
            # }
            # rsp_data = json.dumps(rsp_data).encode('utf-8')
            # flow.response = http.Response.make(200, rsp_data, rsp_header)

        

    def response(self, flow: http.HTTPFlow) -> None:
        """响应数据处理"""
        pass
        # host = flow.request.host_header
        # app_name = app_host_dict.get(host)
        # if app_name in app_list:
        #     rsp_data = flow.response.get_text()
        #     print('响应加密数据', rsp_data)
        #     print('响应解密数据', OlooData.aes_cbc_decrypt(rsp_data, **app_aes_key_dcit[app_name]))

        
        # request_url = urlparse(flow.request.url).path
        # url_params = dict(flow.request.query)
        # if request_url == '/services/live/api/banner-module-config-v3/module/info':
            # request_data = flow.request.content.decode('utf-8')
            # print(request_data)
            # print(request_data, request_data == '{"type":"3"}')
            # if request_data == '{"type":"3"}':
            #     with open(r'D:\模拟数据\装扮.json', 'r', encoding='utf-8') as f:
            #         mock_file_data = f.read()
            #         flow.response = http.Response.make(200, mock_file_data, rsp_header)


        # # 修改响应数据
        # request_url = urlparse(flow.request.url).path
        # if request_url == '/redpacket/receive':
        #     rsp_data = flow.response.get_text()
        #     r_data = json.loads(OlooData.aes_cbc_decrypt(rsp_data, **app_aes_key_dcit[app_name]))
        #     r_data['data']['receiveList'] = []
        #     rsp_data = json.dumps(r_data)
        #     rsp_data = OlooData.aes_cbc_encrypt(rsp_data, **app_aes_key_dcit[app_name])
        #     flow.response = http.Response.make(200, rsp_data, rsp_header)


class Oloo(InteractiveContentview):

    name = "Oloo"

    def prettify(self, data: bytes, metadata: Metadata) -> str:
        flow = metadata.flow
        if not flow or not getattr(flow, "request", None):
            return data.decode("utf-8", errors="replace")
        host = flow.request.host_header
        prettify_str = ''
        app_name = app_host_dict.get(host)
        if app_name in app_list:
            if isinstance(metadata.http_message, http.Request):
                request_data = OlooData.decrypt_data(flow)
                prettify_str = json.dumps(request_data, indent=4, ensure_ascii=False) if request_data is not None else data.decode("utf-8", errors="replace")
            elif isinstance(metadata.http_message, http.Response):
                try:
                    aes_cfg = app_aes_key_dcit.get(app_name)
                    if aes_cfg:
                        rsp_str = OlooData.aes_cbc_decrypt(data.decode("utf-8"), **aes_cfg)
                        prettify_str = json.dumps(json.loads(rsp_str), indent=4, ensure_ascii=False)
                    else:
                        prettify_str = data.decode("utf-8", errors="replace")
                except Exception:
                    prettify_str = data.decode("utf-8", errors="replace")
            else:
                prettify_str = data.decode("utf-8", errors="replace")
        else:
            prettify_str = data.decode("utf-8", errors="replace")
        return prettify_str

    def reencode(self, prettified: str, metadata: Metadata) -> bytes:
        flow = metadata.flow
        if not flow or not getattr(flow, "request", None):
            return prettified.encode("utf-8")
        host = flow.request.host_header
        app_name = app_host_dict.get(host)
        aes_cfg = app_aes_key_dcit.get(app_name)
        if app_name not in app_list or not aes_cfg:
            return prettified.encode("utf-8")

        try:
            parsed_data = json.loads(prettified)
        except Exception:
            parsed_data = None

        if isinstance(metadata.http_message, http.Request):
            print(f"\n[Oloo.reencode] 触发 Request 重编码，URL: {flow.request.url}")
            if parsed_data is not None and isinstance(parsed_data, dict):
                # 根据当前请求参数重新计算 7 位 sn 签名
                OlooData.sign_params(parsed_data, app_name=app_name)
                print(f"[Oloo.reencode] 重新计算签名完成: sn={parsed_data.get('sn')}")
            else:
                print(f"[Oloo.reencode] [!] parsed_data 非合法 JSON 字典: {prettified[:100]}")

            # 1. 如果参数在 URL query 中
            if 'data' in flow.request.query:
                if parsed_data is not None and isinstance(parsed_data, dict):
                    plain_query = urlencode(parsed_data)
                    cipher = OlooData.aes_cbc_encrypt(plain_query, **aes_cfg)
                    flow.request.query['data'] = cipher
                return b""

            # 2. 如果参数在 POST 表单中
            elif 'data' in flow.request.urlencoded_form:
                if parsed_data is not None and isinstance(parsed_data, dict):
                    plain_form = urlencode(parsed_data)
                    cipher = OlooData.aes_cbc_encrypt(plain_form, **aes_cfg)
                    flow.request.urlencoded_form['data'] = cipher
                    return flow.request.raw_content or b""
                return prettified.encode("utf-8")

            # 3. 原始 JSON 请求体
            else:
                if parsed_data is not None:
                    return json.dumps(parsed_data, ensure_ascii=False).encode("utf-8")
                return prettified.encode("utf-8")

        elif isinstance(metadata.http_message, http.Response):
            if parsed_data is not None:
                plain_str = json.dumps(parsed_data, separators=(',', ':'), ensure_ascii=False)
                cipher = OlooData.aes_cbc_encrypt(plain_str, **aes_cfg)
                return cipher.encode("utf-8")
            else:
                cipher = OlooData.aes_cbc_encrypt(prettified, **aes_cfg)
                return cipher.encode("utf-8")

        return prettified.encode("utf-8")

    def render_priority(self, data: bytes, metadata: Metadata) -> float:
        flow = metadata.flow
        if not flow or not getattr(flow, "request", None):
            return 0
        host = flow.request.host_header
        app_name = app_host_dict.get(host)
        if app_name in app_list and not flow.request.url.endswith(('.png', 'css', 'js', '/', 'ico', '.jpg', '.jpeg', '.gif', '.svga', 'mp4', '.mp3')) and 'Mozilla' not in flow.request.headers.get('user-agent', '') and not flow.request.url.startswith('https://cdn.') and 'socket.io' not in flow.request.url:
            return 2
        else:
            return 0


addons = [RequestData()]
add(Oloo)


def rsp_encrypt_oloo(flow: http.HTTPFlow, raw_body: str | bytes) -> str | bytes:
    """
    拦截管理 (Mock) 响应数据 AES 加密处理方法：
    根据当前请求的 host 自动识别 app_name，并使用配置中的 AES Key/IV 对明文内容进行 AES-CBC 加密。
    
    支持:
    - raw_body 为明文 JSON 字符串或 dict/list
    - 自动适配紧凑型 JSON 序列化 (separators=(',', ':'))
    - 加密后直接返回密文字符串 (Base64) 作为 HTTP 响应体
    """
    host = getattr(getattr(flow, "request", None), "host_header", "")
    app_name = app_host_dict.get(host)
    if not app_name:
        # 如果 host 未匹配到 app_name，尝试遍历已知 app_host_dict 查找匹配项
        for h, name in app_host_dict.items():
            if h and h in host:
                app_name = name
                break

    aes_cfg = app_aes_key_dcit.get(app_name) if app_name else None
    if not app_name or not aes_cfg:
        print(f"[rsp_encrypt_oloo] [!] 警告: 未找到域名 [{host}] 对应的 App 或 AES 密钥配置，保持原始响应返回")
        return raw_body

    # 准备待加密字符串
    plain_text = ""
    if isinstance(raw_body, (dict, list)):
        plain_text = json.dumps(raw_body, separators=(',', ':'), ensure_ascii=False)
    elif isinstance(raw_body, bytes):
        try:
            plain_text = raw_body.decode("utf-8")
        except Exception:
            # 如果是纯非文本二进制（如图片），不适合作为文本 JSON 加密，原样返回
            return raw_body
    else:
        plain_text = str(raw_body).strip()

    # 尝试将 JSON 字符串标准化为紧凑格式
    try:
        parsed = json.loads(plain_text)
        plain_text = json.dumps(parsed, separators=(',', ':'), ensure_ascii=False)
    except Exception:
        pass

    try:
        cipher = OlooData.aes_cbc_encrypt(plain_text, **aes_cfg)
        print(f"[rsp_encrypt_oloo] 成功对 [{app_name}] 响应数据完成 AES 加密 (长度: {len(plain_text)} -> {len(cipher)})")
        return cipher
    except Exception as e:
        print(f"[rsp_encrypt_oloo] 加密异常: {e}")
        return raw_body


