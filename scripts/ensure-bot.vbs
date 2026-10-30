' Runs ensure-bot.cmd without flashing a console window (the bot itself still opens its own window).
Set sh = CreateObject("WScript.Shell")
sh.Run """" & Replace(WScript.ScriptFullName, ".vbs", ".cmd") & """", 0, False
