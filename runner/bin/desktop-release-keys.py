"""Release native input after the sole VNC producer stops. No input is logged.

Fail closed if either X11 or XTEST is unavailable. This is a fixed cleanup
operation, not an arbitrary computer-use or command endpoint.
"""
import ctypes as c
import os

x11 = c.CDLL('libX11.so.6')
xtest = c.CDLL('libXtst.so.6')
x11.XOpenDisplay.argtypes = [c.c_char_p]
x11.XOpenDisplay.restype = c.c_void_p
x11.XDefaultRootWindow.argtypes = [c.c_void_p]
x11.XDefaultRootWindow.restype = c.c_ulong
x11.XQueryKeymap.argtypes = [c.c_void_p, c.POINTER(c.c_char)]
x11.XQueryKeymap.restype = c.c_int
x11.XQueryPointer.argtypes = [c.c_void_p, c.c_ulong, c.POINTER(c.c_ulong), c.POINTER(c.c_ulong),
                            c.POINTER(c.c_int), c.POINTER(c.c_int), c.POINTER(c.c_int), c.POINTER(c.c_int), c.POINTER(c.c_uint)]
x11.XQueryPointer.restype = c.c_int
x11.XSync.argtypes = [c.c_void_p, c.c_int]
x11.XCloseDisplay.argtypes = [c.c_void_p]
xtest.XTestQueryExtension.argtypes = [c.c_void_p, c.POINTER(c.c_int), c.POINTER(c.c_int), c.POINTER(c.c_int), c.POINTER(c.c_int)]
xtest.XTestQueryExtension.restype = c.c_int
xtest.XTestFakeKeyEvent.argtypes = [c.c_void_p, c.c_uint, c.c_int, c.c_ulong]
xtest.XTestFakeButtonEvent.argtypes = [c.c_void_p, c.c_uint, c.c_int, c.c_ulong]

display = x11.XOpenDisplay(os.environ.get('DISPLAY', ':99').encode())
if not display:
    raise SystemExit(1)
try:
    extension = [c.c_int() for _ in range(4)]
    if not xtest.XTestQueryExtension(display, *(c.byref(item) for item in extension)):
        raise SystemExit(1)
    keys = c.create_string_buffer(32)
    if not x11.XQueryKeymap(display, keys):
        raise SystemExit(1)
    for code in range(8, 256):
        if keys.raw[code // 8] & (1 << (code % 8)):
            if not xtest.XTestFakeKeyEvent(display, code, 0, 0):
                raise SystemExit(1)
    root = c.c_ulong()
    child = c.c_ulong()
    coordinates = [c.c_int() for _ in range(4)]
    mask = c.c_uint()
    if not x11.XQueryPointer(display, x11.XDefaultRootWindow(display), c.byref(root), c.byref(child),
                            *(c.byref(item) for item in coordinates), c.byref(mask)):
        raise SystemExit(1)
    for button in range(1, 6):
        if mask.value & (1 << (button + 7)):
            if not xtest.XTestFakeButtonEvent(display, button, 0, 0):
                raise SystemExit(1)
    x11.XSync(display, 0)
    # Verify native state after the server has consumed the releases.
    if not x11.XQueryKeymap(display, keys) or any(keys.raw):
        raise SystemExit(1)
    x11.XQueryPointer(display, x11.XDefaultRootWindow(display), c.byref(root), c.byref(child),
                      *(c.byref(item) for item in coordinates), c.byref(mask))
    if mask.value & 0x1f00:
        raise SystemExit(1)
finally:
    x11.XCloseDisplay(display)
