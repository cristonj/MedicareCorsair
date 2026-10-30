import unittest
import os
import tkinter as tk
from desktop import Launcher,BG

@unittest.skipUnless(os.name=='nt','Native Windows geometry check')
class SetupLayoutTests(unittest.TestCase):
 def test_setup_content_fits_a_small_desktop_window(self):
  root=tk.Tk();root.attributes('-alpha',0);root.geometry('900x600');root.update_idletasks()
  try:
   for browser in ('Edge','Chrome','Firefox'):
    app=Launcher.__new__(Launcher);app.root=root;app.browser=browser;app.body=tk.Frame(root,bg=BG,padx=24,pady=18);app.body.pack(fill='both',expand=True)
    app.show_instructions();root.update_idletasks()
    def check(parent):
     for child in parent.winfo_children():
      if child.winfo_manager():
       if child.winfo_class() in ('Label','Button'):
        self.assertGreaterEqual(child.winfo_width(),child.winfo_reqwidth(),f'{browser}: text/image horizontally clipped')
        self.assertGreaterEqual(child.winfo_height(),child.winfo_reqheight(),f'{browser}: {child.winfo_class()} text/image is vertically clipped: {child.cget("text")}')
       self.assertLessEqual(child.winfo_y()+child.winfo_height(),parent.winfo_height()+2,f'{browser}: {child.winfo_class()} extends below parent')
       self.assertLessEqual(child.winfo_x()+child.winfo_width(),parent.winfo_width()+2,f'{browser}: {child.winfo_class()} extends beyond parent')
      check(child)
    check(root);app.body.destroy()
  finally:root.destroy()

if __name__=='__main__':unittest.main()
