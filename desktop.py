"""A simple Windows launcher for the hosted dashboard and browser extension."""
import os
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tkinter as tk
from tkinter import messagebox
import webbrowser

SITE = 'https://medicarecorsair.netlify.app/'
ROOT = Path(getattr(sys, '_MEIPASS', Path(__file__).resolve().parent))
DEST = (Path.home() / 'Library' / 'Application Support' if sys.platform == 'darwin' else Path(os.environ.get('LOCALAPPDATA', str(Path.home())))) / 'MedicareCorsair' / 'extension'
BG = '#f4f7f4'
INK = '#1d3029'
MUTED = '#52695d'
GREEN = '#205b49'


def find_browser(browser):
    if sys.platform == 'darwin':
        names = {'Chrome': 'Google Chrome', 'Edge': 'Microsoft Edge', 'Firefox': 'Firefox'}
        name = names[browser]
        binary = 'firefox' if browser == 'Firefox' else name
        candidates = [Path('/Applications') / (name + '.app') / 'Contents' / 'MacOS' / binary, Path.home() / 'Applications' / (name + '.app') / 'Contents' / 'MacOS' / binary]
        return next((path for path in candidates if path.is_file()), None)
    folders = [os.environ.get('PROGRAMFILES', ''), os.environ.get('PROGRAMFILES(X86)', ''), os.environ.get('LOCALAPPDATA', '')]
    suffix = {'Chrome': 'Google/Chrome/Application/chrome.exe', 'Edge': 'Microsoft/Edge/Application/msedge.exe', 'Firefox': 'Mozilla Firefox/firefox.exe'}[browser]
    return next((Path(folder) / suffix for folder in folders if folder and (Path(folder) / suffix).is_file()), None)


class Launcher:
    def __init__(self, root):
        self.root = root
        self.browser = None
        self.target = None
        root.title('MedicareCorsair')
        root.geometry('620x620')
        root.minsize(560, 580)
        root.configure(bg=BG)
        self.body = tk.Frame(root, bg=BG, padx=38, pady=30)
        self.body.pack(fill='both', expand=True)
        self.show_welcome()

    def clear(self):
        for child in self.body.winfo_children():
            child.destroy()
        tk.Label(self.body, text='MEDICARECORSAIR', bg=BG, fg=GREEN, font=('Segoe UI', 10, 'bold')).pack(anchor='w')

    def title(self, heading, detail):
        tk.Label(self.body, text=heading, bg=BG, fg=INK, font=('Segoe UI', 24, 'bold'), wraplength=520, justify='left').pack(anchor='w', pady=(24, 8))
        tk.Label(self.body, text=detail, bg=BG, fg=MUTED, font=('Segoe UI', 12), wraplength=520, justify='left').pack(anchor='w', pady=(0, 18))

    def button(self, text, command, primary=False):
        button = tk.Button(self.body, text=text, command=command, font=('Segoe UI', 12, 'bold' if primary else 'normal'), bg=GREEN if primary else 'white', fg='white' if primary else INK, activebackground='#34715e' if primary else '#e8f1eb', activeforeground='white' if primary else INK, relief='flat', bd=0, cursor='hand2', padx=18, pady=13, takefocus=True, highlightthickness=1, highlightbackground=GREEN if primary else '#c9d7cd')
        button.pack(fill='x', pady=5)
        return button

    def link(self, text, command):
        tk.Button(self.body, text=text, command=command, bg=BG, fg=GREEN, activebackground=BG, activeforeground=GREEN, font=('Segoe UI', 10, 'underline'), bd=0, cursor='hand2').pack(anchor='w', pady=(12, 0))

    def show_welcome(self):
        self.clear()
        self.title('Let’s get started.', 'Choose the browser you use. We’ll help you add the extension once.')
        self.button('Google Chrome  →', lambda: self.prepare('Chrome'), True)
        self.button('Microsoft Edge  →', lambda: self.prepare('Edge'))
        self.button('Firefox  →', lambda: self.prepare('Firefox'))
        self.link('Open MedicareCorsair without setup', lambda: webbrowser.open(SITE))
        tk.Label(self.body, text='Your browser will ask you to add the extension.', bg=BG, fg=MUTED, font=('Segoe UI', 10), wraplength=510, justify='left').pack(anchor='w', side='bottom', pady=(20, 0))

    def prepare(self, browser):
        executable = find_browser(browser)
        if not executable:
            messagebox.showerror('Browser not found', f'{browser} was not found. Choose another browser or install it first.', parent=self.root)
            return
        try:
            target = DEST / browser.lower()
            target.mkdir(parents=True, exist_ok=True)
            for source in (ROOT / 'extension').iterdir():
                if source.is_file():
                    shutil.copy2(source, target / source.name)
            if browser == 'Firefox':
                manifest = target / 'manifest.json'
                config = json.loads(manifest.read_text(encoding='utf-8'))
                config['background'] = {'scripts': ['background.js']}
                manifest.write_text(json.dumps(config, indent=2), encoding='utf-8')
            self.root.clipboard_clear()
            self.root.clipboard_append(str(target / 'manifest.json' if browser == 'Firefox' else target))
            self.root.update()
            address = {'Chrome':'chrome://extensions', 'Edge':'edge://extensions', 'Firefox':'about:debugging#/runtime/this-firefox'}[browser]
            subprocess.Popen([str(executable), address])
        except (OSError, ValueError, tk.TclError) as error:
            messagebox.showerror('Setup could not start', f'Please try again.\n\n{error}', parent=self.root)
            return
        self.browser = browser
        self.target = target
        self.show_instructions()

    def show_instructions(self):
        self.clear()
        self.title('Add the extension.', f'In {self.browser}, follow these three steps:')
        paste = 'Press Command+Shift+G, paste the copied path, and confirm.' if sys.platform == 'darwin' else 'Paste the copied path, then confirm.'
        steps = [('1', 'Select This Firefox if needed.'), ('2', 'Select Load Temporary Add-on.'), ('3', paste)] if self.browser == 'Firefox' else [('1', 'Turn on Developer mode.'), ('2', 'Select Load unpacked.'), ('3', paste)]
        for number, instruction in steps:
            row = tk.Frame(self.body, bg='white', padx=15, pady=13, highlightthickness=1, highlightbackground='#dce7de')
            row.pack(fill='x', pady=4)
            tk.Label(row, text=number, bg='white', fg=GREEN, font=('Segoe UI', 13, 'bold'), width=3).pack(side='left')
            tk.Label(row, text=instruction, bg='white', fg=INK, font=('Segoe UI', 11), wraplength=430, justify='left').pack(side='left', fill='x', expand=True)
        self.button('Done · Open MedicareCorsair  →', self.open_site, True)
        if self.browser == 'Firefox':
            tk.Label(self.body, text='Firefox removes this temporary add-on when it closes.', bg=BG, fg=MUTED, font=('Segoe UI', 9), wraplength=500).pack(anchor='w')
        self.link('Copy folder path again', self.copy_path)
        self.link('Choose a different browser', self.show_welcome)

    def copy_path(self):
        try:
            self.root.clipboard_clear()
            self.root.clipboard_append(str(self.target / 'manifest.json' if self.browser == 'Firefox' else self.target))
            self.root.update()
            messagebox.showinfo('Copied', 'Folder path copied. Paste it into the folder picker.', parent=self.root)
        except tk.TclError:
            messagebox.showerror('Could not copy', f'Choose this path: {self.target}', parent=self.root)

    def open_site(self):
        executable = find_browser(self.browser)
        try:
            if executable:
                subprocess.Popen([str(executable), SITE])
            else:
                webbrowser.open(SITE)
        except OSError as error:
            messagebox.showerror('Could not open the website', str(error), parent=self.root)


if __name__ == '__main__':
    root = tk.Tk()
    Launcher(root)
    root.mainloop()
