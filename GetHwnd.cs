using System;
using System.Runtime.InteropServices;

public class GetHwnd {
    [DllImport("user32.dll")]
    static extern IntPtr GetForegroundWindow();

    public static void Main() {
        // Just print the current foreground window handle and exit instantly
        Console.WriteLine(GetForegroundWindow().ToInt64());
    }
}
