import unittest
import os
import tkinter as tk
from desktop import Launcher,BG

@unittest.skipUnless(os.name=='nt','Native Windows geometry check')
class SetupLayoutTests(unittest.TestCase):
 def test_setup_content_fits_a_small_desktop_window(self):
  root=tk.Tk();root.attributes('-alpha',0);base_scaling=96/72
  try:
   for scale,browser,size in ((s,b,z) for s in (1,1.25,1.5,2) for b in ('Edge','Chrome','Firefox') for z in ((820,500),(900,600),(1060,710))):
    root.tk.call('tk','scaling',base_scaling*scale);root.geometry(f'{round(size[0]*scale)}x{round(size[1]*scale)}');root.update_idletasks()
    app=Launcher.__new__(Launcher);app.root=root;app.ui_scale=scale;app.browser=browser;app.body=tk.Frame(root,bg=BG,padx=24,pady=18);app.body.pack(fill='both',expand=True)
    app.show_instructions();root.update_idletasks()
    def check(parent):
     for child in parent.winfo_children():
      if child.winfo_manager():
       if child.winfo_class() in ('Label','Button'):
        self.assertGreaterEqual(child.winfo_width(),child.winfo_reqwidth(),f'{browser} at {scale}x: text/image horizontally clipped')
        self.assertGreaterEqual(child.winfo_height(),child.winfo_reqheight(),f'{browser} at {scale}x: {child.winfo_class()} text/image is vertically clipped: {child.cget("text")}')
       self.assertLessEqual(child.winfo_y()+child.winfo_height(),parent.winfo_height()+2,f'{browser} at {scale}x: {child.winfo_class()} extends below parent')
       self.assertLessEqual(child.winfo_x()+child.winfo_width(),parent.winfo_width()+2,f'{browser} at {scale}x: {child.winfo_class()} extends beyond parent')
      check(child)
    check(root);app.body.destroy()
  finally:root.destroy()

if __name__=='__main__':unittest.main()
