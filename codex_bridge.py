#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ChatGPT Web <-> Local Codex Bridge
纯 Python 标准库实现，零依赖，开箱即用。
提供 exec、read、write、edit、list 等智能体必备工具能力。
"""

import json
import os
import sys
import subprocess
from http.server import HTTPServer, BaseHTTPRequestHandler

# 默认工作区：本脚本所在目录
WORKSPACE = os.path.dirname(os.path.abspath(__file__))
PORT = 9090

class BridgeHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        # 简化日志输出
        sys.stdout.write(f"[{self.log_date_time_string()}] {args[0]} - {args[1]}\n")

    def _send_cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def do_OPTIONS(self):
        self.send_response(200)
        self._send_cors()
        self.end_headers()

    def do_GET(self):
        self.send_response(200)
        self._send_cors()
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.end_headers()
        res = {
            'status': 'running',
            'workspace': WORKSPACE,
            'python': sys.version.split()[0]
        }
        self.wfile.write(json.dumps(res, ensure_ascii=False).encode('utf-8'))

    def do_POST(self):
        length = int(self.headers.get('Content-Length', 0))
        raw_body = self.rfile.read(length).decode('utf-8')
        
        try:
            data = json.loads(raw_body)
        except Exception:
            data = {}

        action = data.get('action', '')
        res = {'status': 'ok', 'action': action}

        try:
            if action == 'exec':
                cmd = data.get('command', '').strip()
                print(f"⚡ [执行终端]: {cmd}")
                # Windows 默认使用 powershell 执行
                proc = subprocess.run(
                    cmd,
                    shell=True,
                    cwd=WORKSPACE,
                    capture_output=True,
                    text=True,
                    timeout=120,
                    encoding='utf-8',
                    errors='replace'
                )
                res['stdout'] = proc.stdout
                res['stderr'] = proc.stderr
                res['code'] = proc.returncode

            elif action == 'read':
                rel_path = data.get('path', '').strip()
                target_path = os.path.normpath(os.path.join(WORKSPACE, rel_path))
                print(f"📖 [读取文件]: {rel_path}")
                if not os.path.exists(target_path):
                    res['status'] = 'error'
                    res['message'] = f"File not found: {rel_path}"
                else:
                    with open(target_path, 'r', encoding='utf-8', errors='replace') as f:
                        lines = f.readlines()
                    # 附带行号，方便模型定位与修改
                    numbered = [f"{i+1:4d} | {line}" for i, line in enumerate(lines)]
                    res['content'] = "".join(numbered)
                    res['total_lines'] = len(lines)

            elif action == 'write':
                rel_path = data.get('path', '').strip()
                content = data.get('content', '')
                target_path = os.path.normpath(os.path.join(WORKSPACE, rel_path))
                print(f"✍️ [创建/覆盖文件]: {rel_path} ({len(content)} 字符)")
                os.makedirs(os.path.dirname(target_path), exist_ok=True)
                with open(target_path, 'w', encoding='utf-8') as f:
                    f.write(content)
                res['message'] = f"Successfully wrote {rel_path} ({len(content)} characters)"

            elif action == 'edit':
                # 精准替换片段
                rel_path = data.get('path', '').strip()
                old_str = data.get('old_string', '')
                new_str = data.get('new_string', '')
                target_path = os.path.normpath(os.path.join(WORKSPACE, rel_path))
                print(f"✂️ [精准修改文件]: {rel_path}")
                if not os.path.exists(target_path):
                    res['status'] = 'error'
                    res['message'] = f"File not found: {rel_path}"
                else:
                    with open(target_path, 'r', encoding='utf-8', errors='replace') as f:
                        file_text = f.read()
                    if old_str not in file_text:
                        res['status'] = 'error'
                        res['message'] = "old_string not found in file, please check exact match."
                    else:
                        file_text = file_text.replace(old_str, new_str, 1)
                        with open(target_path, 'w', encoding='utf-8') as f:
                            f.write(file_text)
                        res['message'] = f"Successfully updated {rel_path}"

            elif action == 'list':
                print(f"📂 [检索工作区目录树]")
                file_tree = []
                ignore_dirs = {'.git', 'node_modules', '__pycache__', '.venv', 'venv', '.idea', '.vscode'}
                for root, dirs, files in os.walk(WORKSPACE):
                    dirs[:] = [d for d in dirs if d not in ignore_dirs]
                    for f in files:
                        file_tree.append(os.path.relpath(os.path.join(root, f), WORKSPACE))
                res['files'] = file_tree[:250]
                res['workspace'] = WORKSPACE

            else:
                res['status'] = 'error'
                res['message'] = f"Unknown action: {action}"

        except Exception as err:
            res['status'] = 'error'
            res['message'] = str(err)

        self.send_response(200)
        self._send_cors()
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.end_headers()
        self.wfile.write(json.dumps(res, ensure_ascii=False).encode('utf-8'))

def main():
    server_address = ('127.0.0.1', PORT)
    httpd = HTTPServer(server_address, BridgeHandler)
    print("=" * 64)
    print("  🐳 ChatGPT Web <-> Local Codex Bridge (本地闭环)")
    print("=" * 64)
    print(f"  • 工作区目录: {WORKSPACE}")
    print(f"  • 本地监听点: http://127.0.0.1:{PORT}")
    print(f"  • 运行模式  : 纯本地回环 (0 公网穿透 / 0 延迟 / 极速执行)")
    print("=" * 64)
    print("等待浏览器油猴脚本连接并下发任务...\n")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n正在停止服务...")
        httpd.server_close()

if __name__ == '__main__':
    main()
