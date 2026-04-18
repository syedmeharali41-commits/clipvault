using System;
using System.Runtime.InteropServices;
using System.Threading;

public class WinHelper {
    [DllImport("user32.dll")]
    static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, uint dwExtraInfo);

    [DllImport("user32.dll")]
    static extern bool IsWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    static extern bool IsIconic(IntPtr hWnd);

    const byte VK_CONTROL = 0x11;
    const byte VK_V = 0x56;
    const uint KEYEVENTF_KEYUP = 0x0002;
    const int SW_RESTORE = 9;

    public static void Main(string[] args) {
        if (args.Length == 0) {
            // No args: just print current foreground window handle
            Console.WriteLine(GetForegroundWindow().ToInt64());
            return;
        }

        if (args[0] == "paste" && args.Length > 1) {
            long hwndValue;
            if (!long.TryParse(args[1], out hwndValue) || hwndValue <= 0) {
                Console.Error.WriteLine("Invalid HWND");
                return;
            }

            IntPtr targetHwnd = new IntPtr(hwndValue);

            if (!IsWindow(targetHwnd)) {
                Console.Error.WriteLine("Window no longer valid");
                return;
            }

            // Restore only if minimized
            if (IsIconic(targetHwnd)) {
                ShowWindow(targetHwnd, SW_RESTORE);
            }
            SetForegroundWindow(targetHwnd);

            // Allow the target application window time to process regaining input focus
            Thread.Sleep(50);

            // Fire Ctrl+V via native Win32 steadily
            keybd_event(VK_CONTROL, 0, 0, 0);
            Thread.Sleep(10);
            keybd_event(VK_V, 0, 0, 0);
            Thread.Sleep(20);
            keybd_event(VK_V, 0, KEYEVENTF_KEYUP, 0);
            keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, 0);
        }
    }
}
