"""Open the hosted dashboard and guide extension setup."""
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tkinter as tk
from tkinter import messagebox
import webbrowser

SITE = 'https://medicarecorsair.netlify.app/'
ROOT = Path(getattr(sys, '_MEIPASS', Path(__file__).resolve().parent))
DEST = Path(os.environ.get('LOCALAPPDATA', str(Path.home()))) / 'MedicareCorsair' / 'extension'


def setup(browser):
    folders = [os.environ.get('PROGRAMFILES', ''), os.environ.get('PROGRAMFILES(X86)', ''), os.environ.get('LOCALAPPDATA', '')]
    suffix = 'Google/Chrome/Application/chrome.exe' if browser == 'Chrome' else 'Microsoft/Edge/Application/msedge.exe'
    executable = next((Path(folder) / suffix for folder in folders if folder and (Path(folder) / suffix).is_file()), None)
    if not executable:
        messagebox.showerror('Browser not found', f'{browser} was not found on this computer.')
        return
    DEST.mkdir(parents=True, exist_ok=True)
    for source in (ROOT / 'extension').iterdir():
        if source.is_file():
            shutil.copy2(source, DEST / source.name)
    root.clipboard_clear()
    root.clipboard_append(str(DEST))
    root.update()
    subprocess.Popen([str(executable), 'chrome://extensions' if browser == 'Chrome' else 'edge://extensions'])
    messagebox.showinfo('Add MedicareCorsair', 'Turn on Developer mode, select Load unpacked, and paste the folder path (Ctrl+V).\n\nThe folder path has been copied for you.')


root = tk.Tk()
root.title('MedicareCorsair')
root.geometry('480x260')
tk.Label(root, text='MedicareCorsair', font=('Segoe UI', 20, 'bold')).pack(pady=(20, 8))
tk.Label(root, text='Open the website, then add the extension once.', font=('Segoe UI', 11)).pack(pady=5)
tk.Button(root, text='Open MedicareCorsair', width=30, command=lambda: webbrowser.open(SITE)).pack(pady=5)
tk.Button(root, text='Add extension to Chrome', width=30, command=lambda: setup('Chrome')).pack(pady=5)
tk.Button(root, text='Add extension to Edge', width=30, command=lambda: setup('Edge')).pack(pady=5)
root.after(300, lambda: webbrowser.open(SITE))
root.mainloop()
