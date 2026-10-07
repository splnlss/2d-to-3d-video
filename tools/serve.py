"""Serve the conversion artifacts with byte-range support for media seeking."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import os
from pathlib import Path
import re


class MediaHandler(SimpleHTTPRequestHandler):
    def send_head(self):
        self.byte_range = None
        requested = self.headers.get('Range')
        path = Path(self.translate_path(self.path))
        if (self.command != 'GET' or not requested or not path.is_file()
                or self.headers.get('If-Range')):
            return super().send_head()
        match = re.fullmatch(r'bytes=(\d*)-(\d*)', requested)
        if not match or not any(match.groups()):
            # A simple preview server can ignore unsupported/malformed ranges.
            return super().send_head()
        try:
            source = path.open('rb')
        except OSError:
            self.send_error(404, 'File not found')
            return None
        stat = os.fstat(source.fileno())
        size = stat.st_size
        first, last = match.groups()
        if first:
            start = int(first)
            end = min(int(last), size - 1) if last else size - 1
        else:
            suffix_length = int(last)
            start, end = max(0, size - suffix_length), size - 1
        if size == 0 or start > end or start >= size:
            source.close()
            self.send_response(416)
            self.send_header('Content-Range', f'bytes */{size}')
            self.send_header('Content-Length', '0')
            self.end_headers()
            return None
        self.send_response(206)
        self.send_header('Content-Type', self.guess_type(str(path)))
        self.send_header('Content-Length', str(end - start + 1))
        self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
        self.send_header('Last-Modified', self.date_time_string(stat.st_mtime))
        self.end_headers()
        self.byte_range = (start, end)
        return source

    def end_headers(self):
        self.send_header('Accept-Ranges', 'bytes')
        super().end_headers()

    def copyfile(self, source, outputfile):
        try:
            if self.byte_range is None:
                return super().copyfile(source, outputfile)
            start, end = self.byte_range
            source.seek(start)
            remaining = end - start + 1
            while remaining > 0:
                block = source.read(min(64 * 1024, remaining))
                if not block:
                    break
                outputfile.write(block)
                remaining -= len(block)
        except (BrokenPipeError, ConnectionResetError):
            # Video players routinely cancel one request when starting a seek.
            return


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=55000)
    args = parser.parse_args()
    directory = Path(__file__).resolve().parents[1] / 'public'
    server = ThreadingHTTPServer(('127.0.0.1', args.port),
                                 partial(MediaHandler, directory=str(directory)))
    print(f'Serving video preview on http://127.0.0.1:{args.port}', flush=True)
    server.serve_forever()
