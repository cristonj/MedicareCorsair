"""A simple Windows launcher for the hosted dashboard and browser extension."""
import os
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tkinter as tk
from tkinter import messagebox
from PIL import Image, ImageTk
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




class Launcher:
    def __init__(self, root):
        self.root = root
        try:
            self.server = ThreadingHTTPServer(('127.0.0.1', 8000), Handler)
        except OSError as error:
            messagebox.showerror('MedicareCorsair cannot open twice', 'Close the previous MedicareCorsair helper window, then open this version again. Your browser tab can stay open. If no helper is open, another program is using local port 8000.', parent=root)
            root.destroy()
            return
        data.start_scheduler()
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        root.protocol('WM_DELETE_WINDOW', self.close)
        self.browser = None
        self.target = None
        root.title('MedicareCorsair')
        root.geometry(f'{min(1060,root.winfo_screenwidth()-60)}x{min(710,root.winfo_screenheight()-90)}')
        root.minsize(min(820,root.winfo_screenwidth()-60), min(560,root.winfo_screenheight()-90))
        root.configure(bg=BG)
        self.body = tk.Frame(root, bg=BG, padx=24, pady=18)
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
        tk.Label(self.body, text='Your browser will ask you to add the extension.', bg=BG, fg=MUTED, font=('Segoe UI', 10), wraplength=510, justify='left').pack(anchor='w', side='bottom', pady=(20, 0))

    def prepare(self, browser):
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

        except (OSError, ValueError, tk.TclError) as error:
            messagebox.showerror('Setup could not start', f'Please try again.\n\n{error}', parent=self.root)
            return
        self.browser = browser
        self.target = target
        self.show_instructions()

    def copy_text(self, text, notice='Copied. Paste it in the browser.'):
        self.root.clipboard_clear()
        self.root.clipboard_append(text)
        self.root.update()
        if hasattr(self, 'notice'): self.notice.configure(text=notice)

    def show_instructions(self, step=0):
        self.clear()
        address={'Edge':'edge://extensions/', 'Chrome':'chrome://extensions/', 'Firefox':'about:debugging#/runtime/this-firefox'}[self.browser]
        guide=json.loads((ROOT/'setup-guides.json').read_text(encoding='utf-8-sig'))[self.browser.lower()]
        tk.Label(self.body,text=f'Add to {self.browser}',bg=BG,fg=INK,font=('Arial',20,'bold')).pack(anchor='w',pady=(10,12))
        footer='Return to your original MedicareCorsair tab and refresh it. Keep this helper open.'
        if self.browser=='Firefox':footer+=' Firefox removes temporary add-ons when it closes.'
        finish=tk.Frame(self.body,bg=BG);finish.pack(side='bottom',fill='x',pady=(8,0))
        self.notice=tk.Label(finish,text='',bg=BG,fg=GREEN,font=('Arial',10));self.notice.pack(fill='x')
        tk.Label(finish,text=footer,bg=BG,fg=INK,font=('Arial',11,'bold'),wraplength=max(400,self.root.winfo_width()-80),justify='left').pack(fill='x')
        tk.Button(finish,text='Choose a different browser',command=self.show_welcome,bg=BG,fg=GREEN,relief='flat',font=('Arial',10,'underline')).pack(anchor='w')
        columns=tk.Frame(self.body,bg=BG);columns.pack(fill='both',expand=True)
        picture=tk.Frame(columns,bg=BG);picture.pack(side='left',fill='both',expand=True,padx=(0,20))
        instructions=tk.Frame(columns,bg=BG,width=330);instructions.pack(side='right',fill='y');instructions.pack_propagate(False)
        path=ROOT/'assets'/'setup'/f'{self.browser.lower()}-extensions.png'
        with Image.open(path) as im:
            self.source_image=im.crop((0,0,im.width,310)) if self.browser=='Firefox' else im.copy()
        preview=self.source_image.copy();preview.thumbnail((max(250,min(600,self.root.winfo_width()-410)),max(200,min(300,self.root.winfo_height()-330))))
        self.preview_photo=ImageTk.PhotoImage(preview)
        tk.Label(picture,image=self.preview_photo,bg='white').pack(anchor='center',expand=True)
        tk.Label(picture,text='Official example — look for MedicareCorsair, not the sample extension.',bg=BG,fg=MUTED,font=('Arial',10),wraplength=max(260,self.root.winfo_width()-430)).pack(pady=6)
        tk.Button(picture,text='Enlarge screenshot',command=self.enlarge_screenshot,bg='white',fg=GREEN,relief='flat',font=('Arial',11)).pack()
        def line(number,title,text):
            tk.Label(instructions,text=f'{number}. {title}',bg=BG,fg=INK,font=('Arial',13,'bold'),anchor='w',justify='left').pack(fill='x',pady=(10,3))
            tk.Label(instructions,text=text,bg=BG,fg=INK,font=('Arial',11),wraplength=325,anchor='w',justify='left').pack(fill='x')
        open_keys='Command+T, Command+V, then Return' if sys.platform=='darwin' else 'Ctrl+T, Ctrl+V, then Enter'
        line(1,'Open this address',f'Copy the address below. In the same {self.browser} browser, press {open_keys}.')
        tk.Button(instructions,text='Copy '+address,command=lambda:self.copy_text(address,'Address copied. Paste it in your browser’s address bar.'),bg='white',fg=GREEN,font=('Arial',11,'bold'),relief='solid',bd=1,padx=6,pady=8,wraplength=315).pack(fill='x',pady=6)
        if self.browser=='Firefox':
            line(2,'Load Temporary Add-on','Select This Firefox on the left, then Load Temporary Add-on at the top.')
        else:
            where='bottom-left' if self.browser=='Edge' else 'top-right'
            line(2,'Developer mode → Load unpacked',f'Turn on Developer mode at the {where}. Then click Load unpacked at the top.')
        path_keys='Command+Shift+G, Command+V, then Return' if sys.platform=='darwin' else 'Ctrl+L, Ctrl+V, then Enter'
        confirm='Open if asked' if self.browser=='Firefox' else 'Select' if sys.platform=='darwin' else 'Select Folder'
        line(3,'Select the setup folder' if self.browser!='Firefox' else 'Select manifest.json',f'Copy the path below. In the picker press {path_keys}. Click {confirm}.')
        tk.Button(instructions,text='Copy setup path',command=lambda:self.copy_text(clipboard_path(self.browser),'Setup path copied. Paste it into the folder picker.'),bg=GREEN,fg='white',relief='flat',font=('Arial',12,'bold'),pady=9).pack(fill='x',pady=8)
    def enlarge_screenshot(self):
        window=tk.Toplevel(self.root);window.title(f'{self.browser} — official screenshot')
        preview=self.source_image.copy();preview.thumbnail((window.winfo_screenwidth()-80,window.winfo_screenheight()-120))
        window.photo=ImageTk.PhotoImage(preview)
        tk.Label(window,image=window.photo).pack()
        tk.Button(window,text='Close',command=window.destroy,font=('Arial',12),padx=20,pady=8).pack()



if __name__ == '__main__':
    root = tk.Tk()
    Launcher(root)
    root.mainloop()
