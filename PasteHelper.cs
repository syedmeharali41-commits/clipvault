using System;
using System.Runtime.InteropServices;
using System.Threading;

public class PasteHelper {
    [DllImport("user32.dll")]
    static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, uint dwExtraInfo);

    [DllImport("user32.dll")]
    static extern IntPtr GetForegroundWindow();

    const byte VK_CONTROL = 0x11;
    const byte VK_V = 0x56;
    const uint KEYEVENTF_EXTENDEDKEY = 0x0001;
    const uint KEYEVENTF_KEYUP = 0x0002;
    const int SW_RESTORE = 9;

    public static void Main(string[] args) {
        IntPtr targetHwnd = IntPtr.Zero;

        // Accept target window handle as first argument
        if (args.Length > 0) {
            long hwndValue;
            if (long.TryParse(args[0], out hwndValue) && hwndValue > 0) {
                targetHwnd = new IntPtr(hwndValue);
            }
        }

        // Restore and focus the target window
        if (targetHwnd != IntPtr.Zero) {
            ShowWindow(targetHwnd, SW_RESTORE);
            SetForegroundWindow(targetHwnd);
            Thread.Sleep(80);
        } else {
            Thread.Sleep(200);
        }

        // Fire Ctrl+V via Win32 keybd_event (most native method)
        keybd_event(VK_CONTROL, 0, 0, 0);
        keybd_event(VK_V, 0, 0, 0);
        Thread.Sleep(30);
        keybd_event(VK_V, 0, KEYEVENTF_KEYUP, 0);
        keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, 0);
    }
}
