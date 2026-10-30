"""A simple Windows launcher for the hosted dashboard and browser extension."""
import os
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tkinter as tk
from tkinter import messagebox
import threading
from http.server import ThreadingHTTPServer
import webbrowser
from backend import data
from server import Handler

SITE = 'https://medicarecorsair.netlify.app/'
ROOT = Path(getattr(sys, '_MEIPASS', Path(__file__).resolve().parent))
DEST = (Path.home() / 'Library' / 'Application Support' if sys.platform == 'darwin' else Path(os.environ.get('LOCALAPPDATA', str(Path.home())))) / 'MedicareCorsair' / 'extension'
BG = '#f4f7f4'
INK = '#1d3029'
MUTED = '#52695d'
GREEN = '#205b49'


def clipboard_path(browser):
    """Use a portable path so the clipboard does not contain the account name."""
    suffix = '/manifest.json' if browser == 'Firefox' else ''
    if sys.platform == 'darwin':
        return f'~/Library/Application Support/MedicareCorsair/extension/{browser.lower()}{suffix}'
    return f'%LOCALAPPDATA%\\MedicareCorsair\\extension\\{browser.lower()}' + ('\\manifest.json' if browser == 'Firefox' else '')


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
        try:
            self.server = ThreadingHTTPServer(('127.0.0.1', 8000), Handler)
        except OSError as error:
            messagebox.showerror('Cannot start MedicareCorsair', f'Port 8000 is already in use. Close the other app using it and try again.\n\n{error}', parent=root)
            root.destroy()
            return
        data.start_scheduler()
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        root.protocol('WM_DELETE_WINDOW', self.close)
        self.browser = None
        self.target = None
        root.title('MedicareCorsair')
        root.geometry('620x620')
        root.minsize(560, 580)
        root.configure(bg=BG)
        self.body = tk.Frame(root, bg=BG, padx=38, pady=30)
        self.body.pack(fill='both', expand=True)
        self.show_welcome()

    def close(self):
        self.server.shutdown()
        self.server.server_close()
        self.root.destroy()

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
        self.title('Let’s get started.', 'Keep this window open. Choose your browser to add the extension.')
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
            self.root.clipboard_append(clipboard_path(browser))
            self.root.update()
            address = {'Chrome':'chrome://extensions', 'Edge':'edge://extensions', 'Firefox':'about:debugging#/runtime/this-firefox'}[browser]
            subprocess.Popen([str(executable), address])
        except (OSError, ValueError, tk.TclError) as error:
            messagebox.showerror('Setup could not start', f'Please try again.\n\n{error}', parent=self.root)
            return
        self.browser = browser
        self.target = target
        self.show_instructions()

    def show_instructions(self, step=0):
        self.clear()
        guide=json.loads((ROOT/'setup-guides.json').read_text(encoding='utf-8-sig'))[self.browser.lower()]
        steps=list(guide['install'])
        if sys.platform == 'darwin':
            steps += [{'title':'Open Go to Folder', 'text':'In the picker, press Command + Shift + G. A small path box opens.', 'label':'Command + Shift + G', 'kind':'button'}, {'title':'Paste the setup path', 'text':'Press Command + V, then Return. The setup path is already copied.', 'label':'Command + V  →  Return', 'kind':'button'}]
        else:
            steps += [{'title':'Select the address bar', 'text':'In the picker, press Ctrl + L to select the address bar at the top.', 'label':'Ctrl + L', 'kind':'button'}, {'title':'Paste the setup path', 'text':'Press Ctrl + V, then Enter. The setup path is already copied.', 'label':'Ctrl + V  →  Enter', 'kind':'button'}]
        steps += [{'title':'Confirm your selection', 'text':'Choose manifest.json and click Open.' if self.browser=='Firefox' else 'Click Select Folder on Windows, or Select on Mac.', 'label':'Open' if self.browser=='Firefox' else 'Select Folder / Select', 'kind':'button'}, {'title':'Check the extension appears', 'text':'Look for MedicareCorsair in the extension list. Then open the website and click Check setup.', 'label':'MedicareCorsair', 'kind':'button'}]
        item=steps[step]
        self.title(item['title'], f"Step {step+1} of {len(steps)} · {self.browser}")
        canvas=tk.Canvas(self.body,width=500,height=100,bg='white',highlightthickness=1,highlightbackground='#c9d7cd')
        canvas.pack(fill='x',pady=8)
        canvas.create_rectangle(18,25,365,78,fill='#edf3ee',outline=GREEN,width=2)
        canvas.create_text(35,51,text=item['label'],anchor='w',fill=INK,font=('Arial',12,'bold'))
        if item['kind']=='toggle':
            canvas.create_oval(290,38,340,66,fill=GREEN,outline=GREEN)
            canvas.create_oval(317,41,338,63,fill='white',outline='white')
        canvas.create_line(455,50,370,50,fill='#b34d2c',width=4,arrow=tk.LAST)
        tk.Label(self.body,text='Illustration · browser layouts may vary',bg=BG,fg=MUTED,font=('Arial',9)).pack(anchor='w')
        tk.Label(self.body,text=item['text'],bg=BG,fg=INK,font=('Arial',12),wraplength=510,justify='left').pack(anchor='w',pady=16)
        if step<len(steps)-1:
            self.button('I did this · Next →',lambda:self.show_instructions(step+1),True)
        else:
            self.button('Open MedicareCorsair →',self.open_site,True)
        if step:
            self.link('← Back',lambda:self.show_instructions(step-1))
        self.link('Copy setup path again',self.copy_path)
        self.link('Open official instructions with screenshots',lambda:webbrowser.open(guide['help']))

    def copy_path(self):
        try:
            self.root.clipboard_clear()
            self.root.clipboard_append(clipboard_path(self.browser))
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
