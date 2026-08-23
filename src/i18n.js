// UI translation.
//
// Rather than tagging every element with a data-i18n key, the dictionary is
// keyed by the exact English string that already lives in index.html / renderer.js.
// applyLanguage() walks the UI, swaps any text node or title/placeholder it
// recognizes, and remembers the original so switching back to English is exact.
//
// User content is never touched: the editor, the markdown preview, tab names
// and the chat transcripts are in SKIP_SELECTORS below.
(function () {
  const FA = {
    // ---- title bar / rail ----
    'promptpad': 'پرامپت‌پد',
    'new': 'جدید',
    'templates': 'قالب‌ها',
    'discover': 'کشف',
    'prompt lab': 'آزمایشگاه',
    'Fast Save': 'ذخیره سریع',
    'AI Chat': 'چت هوش مصنوعی',
    'Templates': 'قالب‌ها',
    'Discover': 'کشف',
    'Prompt Lab': 'آزمایشگاه پرامپت',
    'Settings': 'تنظیمات',
    'settings': 'تنظیمات',
    // ---- profiles ----
    'Cancel': 'انصراف',
    'Create': 'ساختن',
    'Profiles': 'پروفایل‌ها',
    'Separate sets of tabs, switched from the title bar': 'مجموعه‌های جدا از تب‌ها که از نوار عنوان عوض می‌شوند',
    'Turning this off only hides the switcher — your profiles and their tabs are kept.':
      'خاموش کردن این گزینه فقط سوییچر را پنهان می‌کند — پروفایل‌ها و تب‌هایشان حفظ می‌شوند.',
    'Switch profile': 'تعویض پروفایل',
    'Add profile': 'افزودن پروفایل',
    // ---- move / copy tabs & groups between profiles ----
    'Move to profile': 'انتقال به پروفایل',
    'Copy to profile': 'کپی به پروفایل',
    'Profile': 'پروفایل',
    'Move to': 'انتقال به',
    'Copy to': 'کپی به',
    // ---- Pro themes ----
    'Pro': 'حرفه‌ای',
    'Restart PromptPad to finish applying this theme.':
      'برای کامل شدن این تم، پرامپت‌پد را یک‌بار ببند و باز کن.',
    'Restart': 'راه‌اندازی دوباره',
    'New in this update: Pro themes — Glass, Matrix, Old TV, Music and more.':
      'تازه در این نسخه: تم‌های حرفه‌ای — شیشه‌ای، ماتریکس، تلویزیون قدیمی، موزیک و بیشتر.',
    'Take a look': 'ببین',
    'Moved to': 'منتقل شد به',
    'Copied to': 'کپی شد به',
    "Couldn't move those to that profile.": 'انتقال به آن پروفایل انجام نشد.',
    // ---- shared notes (live collaboration) ----
    'Invitations': 'دعوت‌نامه‌ها',
    'No invitations right now.': 'الان دعوت‌نامه‌ای نداری.',
    'invited you to': 'تو را دعوت کرد به',
    'You can edit it with them.': 'می‌توانی همراهشان ویرایش کنی.',
    'You can read it.': 'فقط می‌توانی بخوانی.',
    'Accept': 'قبول',
    'Decline': 'رد',
    'New invitation from': 'دعوت‌نامه جدید از',
    'Joined': 'وارد شدی به',
    "Couldn't open that note": 'باز کردن آن یادداشت انجام نشد',
    'PromptPad — shared note': 'پرامپت‌پد — یادداشت اشتراکی',
    'share note': 'یادداشت اشتراکی',
    'Share note': 'یادداشت اشتراکی',
    'Share & invite…': 'اشتراک‌گذاری و دعوت…',
    'Sharing & people…': 'اشتراک‌گذاری و افراد…',
    'Username': 'نام کاربری',
    'Can edit': 'می‌تواند ویرایش کند',
    'Can view': 'فقط می‌بیند',
    'Invite': 'دعوت',
    'Sending…': 'در حال ارسال…',
    'Invitation sent to': 'دعوت‌نامه فرستاده شد برای',
    'Enter a username.': 'یک نام کاربری وارد کن.',
    'No user with that username.': 'کاربری با این نام کاربری پیدا نشد.',
    "That's you.": 'این خودتی.',
    'They are already in this note.': 'او همین حالا در این یادداشت هست.',
    'They already have a pending invitation.': 'یک دعوت‌نامه در انتظار برایش فرستاده شده.',
    'Only the note owner can invite people.': 'فقط صاحب یادداشت می‌تواند کسی را دعوت کند.',
    'Could not send that invitation.': 'ارسال دعوت‌نامه انجام نشد.',
    'People': 'افراد',
    'Loading…': 'در حال بارگذاری…',
    'owner': 'صاحب',
    'can edit': 'ویرایشگر',
    'can view': 'بیننده',
    'invited': 'دعوت‌شده',
    'Cancel invitation': 'لغو دعوت‌نامه',
    'Remove from note': 'حذف از یادداشت',
    'Everyone here edits the same note live.': 'همه‌ی این افراد همین یادداشت را زنده ویرایش می‌کنند.',
    'Stop sharing': 'پایان اشتراک‌گذاری',
    'Leave note': 'خروج از یادداشت',
    'Stopped sharing': 'اشتراک‌گذاری پایان یافت',
    'Left the note': 'از یادداشت خارج شدی',
    'Sharing ended for': 'اشتراک‌گذاری تمام شد برای',
    'Stop sharing this note? Everyone else loses access — your copy stays.':
      'اشتراک‌گذاری این یادداشت تمام شود؟ بقیه دسترسی‌شان را از دست می‌دهند — نسخه‌ی تو می‌ماند.',
    'Leave this note? Your copy of the text stays here.':
      'از این یادداشت خارج می‌شوی؟ نسخه‌ی متن پیش خودت می‌ماند.',
    'Shared notes are turned off': 'یادداشت‌های اشتراکی خاموش است',
    'Sign in on the Discover tab first': 'اول از تب کشف وارد حساب شو',
    "Couldn't share that note": 'اشتراک‌گذاری آن یادداشت انجام نشد',
    'Shared note — edited live with others': 'یادداشت اشتراکی — زنده با بقیه ویرایش می‌شود',
    'Shared note — you can read it': 'یادداشت اشتراکی — فقط می‌توانی بخوانی',
    'Connected — edits are shared live': 'وصل است — ویرایش‌ها زنده به اشتراک گذاشته می‌شوند',
    'Offline — your edits are saved and will sync when you reconnect':
      'آفلاین — ویرایش‌هایت ذخیره می‌شود و بعد از وصل شدن همگام می‌شود',
    'Connecting…': 'در حال اتصال…',
    'is typing…': 'در حال نوشتن است…',
    'people are typing…': 'نفر در حال نوشتن‌اند…',
    'View only': 'فقط خواندن',
    'Only you here': 'فقط خودت اینجایی',
    'here': 'نفر اینجا',
    'you': 'خودت',
    'Shared notes': 'یادداشت‌های اشتراکی',
    'Invite another user to edit one of your notes with you, live':
      'یک کاربر دیگر را دعوت کن تا یکی از یادداشت‌هایت را زنده با تو ویرایش کند',
    'New profile': 'پروفایل جدید',
    'Profile name': 'نام پروفایل',
    'Rename profile': 'تغییر نام پروفایل',
    'Delete profile': 'حذف پروفایل',
    'its notes, groups, templates and Fast Save messages are removed for good. Prompt Lab and Discover are shared and stay.':
      'یادداشت‌ها، گروه‌ها، قالب‌ها و پیام‌های ذخیره سریع آن برای همیشه پاک می‌شوند. آزمایشگاه پرامپت و کشف مشترک‌اند و باقی می‌مانند.',
    'Close': 'بستن',
    'Minimize': 'کوچک کردن',
    'Maximize': 'بزرگ کردن',
    'Restore': 'بازگرداندن',
    'Always on top': 'همیشه رو',
    'Search (Ctrl+F)': 'جست‌وجو (Ctrl+F)',
    'Focus mode (Ctrl+Shift+F)': 'حالت تمرکز (Ctrl+Shift+F)',
    'Focus mode · press Esc to exit': 'حالت تمرکز · برای خروج Esc بزن',
    'Hide tabs (Ctrl+\\)': 'مخفی کردن تب‌ها (Ctrl+\\)',
    'Show tabs (Ctrl+\\)': 'نمایش تب‌ها (Ctrl+\\)',
    'New prompt (Ctrl+T)': 'پرامپت جدید (Ctrl+T)',
    'Discover — shared prompt gallery': 'کشف — گالری اشتراکی پرامپت‌ها',
    'Prompt Lab — your personal prompt library': 'آزمایشگاه — کتابخانه شخصی پرامپت‌های تو',
    'Hover to open': 'برای باز شدن نشانگر را روی آن ببر',
    'Drag to resize tabs': 'برای تغییر اندازه تب‌ها بکش',
    'Drag to resize': 'برای تغییر اندازه بکش',
    'No prompts yet. Hit "new" to start.': 'هنوز پرامپتی نداری. برای شروع «جدید» را بزن.',

    // ---- editor / status bar ----
    'Write your prompt here…': 'پرامپتت را اینجا بنویس…',
    'Todo': 'کار',
    'Emoji': 'ایموجی',
    'Link': 'لینک',
    'Align': 'تراز',
    'Auto': 'خودکار',
    'Justify': 'هم‌تراز',
    'Clean': 'تمیزکاری',
    'Improve': 'بهبود',
    'Improve Prompt': 'بهبود پرامپت',
    'Improve prompt': 'بهبود پرامپت',
    // ---- AI actions menu ----
    'Translate (FA ⇄ EN)': 'ترجمه (فارسی ⇄ انگلیسی)',
    'Summarize': 'خلاصه کن',
    'Fix grammar & spelling': 'اصلاح گرامر و املا',
    'Make professional': 'لحن رسمی',
    'Make casual': 'لحن خودمانی',
    'Make concise': 'کوتاه و مختصر',
    'AI · on selection': 'هوش مصنوعی · روی متنِ انتخاب‌شده',
    'AI · on the whole tab': 'هوش مصنوعی · روی کلِ تب',
    'Custom instruction…': 'دستور دلخواه…',
    'Manage custom actions…': 'مدیریت اکشن‌های دلخواه…',
    'Keep as an action': 'نگه‌داشتن به‌عنوان اکشن',
    'Remove from recents': 'حذف از اخیرها',
    // ---- custom instruction dialog ----
    'Custom AI instruction': 'دستور دلخواه هوش مصنوعی',
    'e.g. list these lines by topic': 'مثلاً: این خط‌ها رو بر اساس موضوع دسته‌بندی کن',
    'Runs on your selection': 'روی متنِ انتخاب‌شده اجرا می‌شه',
    'Runs on the whole tab': 'روی کلِ تب اجرا می‌شه',
    'Editing a saved action': 'ویرایشِ یک اکشنِ ذخیره‌شده',
    'Saved to the AI actions menu': 'به منوی اکشن‌های AI اضافه می‌شه',
    'Save as action': 'ذخیره به‌عنوان اکشن',
    'Action name': 'نامِ اکشن',
    'Run': 'اجرا',
    'Save': 'ذخیره',
    // ---- custom actions in Settings ----
    'Custom AI actions': 'اکشن‌های دلخواه هوش مصنوعی',
    'No custom actions yet.': 'هنوز اکشنِ دلخواهی نساختی.',
    '+ Add action': '+ افزودن اکشن',
    'Your own instructions, added to the AI actions menu. Select some text, right-click → AI actions, and pick one.':
      'دستورهای خودت که به منوی اکشن‌های AI اضافه می‌شن. یه متن رو انتخاب کن، راست‌کلیک ← AI actions، و یکی رو بزن.',
    // ---- provider & model ----
    'Provider': 'سرویس‌دهنده',
    'Model': 'مدل',
    'Auto — recommended': 'خودکار — پیشنهادی',
    'OpenRouter (free)': 'OpenRouter (رایگان)',
    'Google AI Studio': 'گوگل AI Studio',
    'Anthropic (Claude)': 'انتروپیک (Claude)',
    'Custom endpoint…': 'سرویس دلخواه…',
    // ---- live model list ----
    'Free': 'رایگان',
    'Paid': 'پولی',
    'Asking the provider…': 'در حال پرسیدن از سرویس‌دهنده…',
    'Loaded from your provider': 'از سرویس‌دهنده گرفته شد',
    'Built-in list — press ↻ to load the real one': 'لیستِ داخلی — برای لیستِ واقعی ↻ را بزن',
    "Couldn't load the model list.": 'لیستِ مدل‌ها گرفته نشد.',
    'Your saved model is gone from this provider — switched to Auto':
      'مدلی که انتخاب کرده بودی دیگر روی این سرویس نیست — به Auto برگشت',
    'Voice': 'صدا',
    'Voice to Text': 'صدا به متن',
    'Markdown': 'مارک‌داون',
    'Paste': 'چسباندن',
    'Copy': 'کپی',
    'Image': 'تصویر',
    'Attach File': 'پیوست فایل',
    'More': 'بیشتر',
    'Toggle todo on this line': 'تبدیل این خط به آیتم کار',
    'Insert link (Ctrl+K)': 'درج لینک (Ctrl+K)',
    'Align text': 'تراز کردن متن',
    'Color': 'رنگ',
    'Group': 'گروه',
    'Direction': 'جهت',
    'Left to right': 'چپ به راست',
    'Right to left': 'راست به چپ',
    'Justify text': 'هم‌تراز کردن متن',
    'Clean up spacing': 'مرتب کردن فاصله‌ها',
    'Improve this prompt': 'بهبود این پرامپت',
    'Speech to text': 'گفتار به متن',
    'Markdown preview (Ctrl+M)': 'پیش‌نمایش مارک‌داون (Ctrl+M)',
    'Opens in markdown preview': 'با پیش‌نمایش مارک‌داون باز می‌شود',
    'Paste clipboard here': 'چسباندن کلیپ‌بورد اینجا',
    'Copy prompt (Ctrl+Shift+C)': 'کپی پرامپت (Ctrl+Shift+C)',
    'Insert image': 'درج تصویر',
    'Files attached to this tab': 'فایل‌های پیوست این تب',
    'Generate preview image from this prompt': 'ساخت تصویر پیش‌نمایش از این پرامپت',
    'Generate image from this block': 'ساخت تصویر از این بلوک',
    'Copy code': 'کپی کد',

    // ---- find / replace ----
    'Find…': 'پیدا کن…',
    'Replace…': 'جایگزین کن…',
    'Replace': 'جایگزینی',
    'All': 'همه',
    'Find': 'پیدا کردن',
    'Find & replace': 'پیدا کردن و جایگزینی',
    'Previous (Shift+Enter)': 'قبلی (Shift+Enter)',
    'Next (Enter)': 'بعدی (Enter)',
    'Search all tabs': 'جست‌وجو در همه تب‌ها',

    // ---- Fast Save / AI chat ----
    'Search messages': 'جست‌وجوی پیام‌ها',
    'Media gallery': 'گالری رسانه',
    'Search saved messages…': 'جست‌وجو در پیام‌های ذخیره‌شده…',
    'Delete': 'حذف',
    'Clear': 'پاک کردن',
    'Editing message': 'ویرایش پیام',
    'Cancel (Esc)': 'انصراف (Esc)',
    'Remove': 'حذف',
    'Attach image': 'پیوست تصویر',
    'Attach file': 'پیوست فایل',
    'Type and press Enter to save… (Shift+Enter = new line)': 'بنویس و Enter بزن تا ذخیره شود… (Shift+Enter = خط جدید)',
    'Save (Enter)': 'ذخیره (Enter)',
    'Message the AI… (Shift+Enter = new line)': 'به هوش مصنوعی پیام بده… (Shift+Enter = خط جدید)',
    'Send (Enter)': 'ارسال (Enter)',
    'Clear chat': 'پاک کردن گفت‌وگو',
    'Dismiss': 'بستن',

    // ---- settings: language ----
    'Language': 'زبان',
    'English': 'English',
    'Mirror layout (RTL)': 'آینه‌کردن چیدمان (راست‌به‌چپ)',
    'Moves the sidebar to the right and flips the whole layout': 'نوار کناری را به راست می‌برد و کل چیدمان را برعکس می‌کند',

    // ---- settings: appearance ----
    'Theme': 'پوسته',
    'Font': 'قلم',
    'Font size': 'اندازه قلم',
    'Also: Ctrl + scroll, Ctrl+= / Ctrl+- / Ctrl+0': 'همچنین: Ctrl + اسکرول، Ctrl+= / Ctrl+- / Ctrl+0',
    'Smaller': 'کوچک‌تر',
    'Bigger': 'بزرگ‌تر',
    'Tab size': 'اندازه تب',
    'Small': 'کوچک',
    'Medium': 'متوسط',
    'Large': 'بزرگ',

    // ---- settings: handy ----
    'Handy mode': 'حالت دم‌دستی',
    'Dock the window to a thin line at the screen edge': 'پنجره را به یک نوار باریک در لبه صفحه جمع می‌کند',
    'When disabled, the shortcut should…': 'وقتی غیرفعال است، میان‌بر چه کند…',
    'Send to tray': 'به سینی سیستم',
    'Do nothing': 'هیچ کاری نکند',
    'Handy mode — dock position': 'حالت دم‌دستی — جای اتصال',
    'Left': 'چپ',
    'Center': 'وسط',
    'Right': 'راست',
    'Handy mode — hide the panel': 'حالت دم‌دستی — بستن پنل',
    'When you click away': 'وقتی جای دیگری کلیک کنی',
    'When the mouse leaves': 'وقتی نشانگر بیرون برود',
    '"Click away" keeps it open while you\'re typing; "Mouse leaves" tucks it back the moment your cursor leaves the panel.':
      '«کلیک بیرون» تا وقتی تایپ می‌کنی باز نگهش می‌دارد؛ «خروج نشانگر» به‌محض بیرون رفتن نشانگر جمعش می‌کند.',
    'Handy mode — show/hide shortcut': 'حالت دم‌دستی — میان‌بر نمایش/مخفی',
    'Click, then press a key combo': 'کلیک کن، بعد ترکیب کلید را بزن',
    'Reset': 'بازنشانی',
    'Collapses the window to a thin line at the bottom edge; hover it to slide the notepad open. Toggle with the dock button in the title bar or': 'پنجره را به یک نوار باریک در لبه پایین جمع می‌کند؛ نشانگر را رویش ببر تا باز شود. با دکمه‌ی داک در نوار عنوان یا',
    'Handy mode — dock to edge': 'حالت دم‌دستی — اتصال به لبه',
    'Exit handy mode': 'خروج از حالت دم‌دستی',
    'Reuse {key} to hide/restore the window': 'از {key} برای مخفی/بازگرداندن پنجره استفاده کن',

    // ---- settings: sidebar & tabs ----
    'Sidebar': 'نوار کناری',
    'Tabs': 'تب‌ها',
    'Show the templates button in the sidebar': 'نمایش دکمه قالب‌ها در نوار کناری',
    'Chat-style quick notes pinned above your tabs': 'یادداشت‌های سریع چت‌مانند، بالای تب‌ها',
    'Shared prompt gallery tab (browse & publish prompts)': 'تب گالری اشتراکی پرامپت‌ها (مرور و انتشار)',
    'Your personal, local library of prompts + media': 'کتابخانه شخصی و محلی پرامپت‌ها و رسانه‌ها',
    'Chat panel in the sidebar': 'پنل گفت‌وگو در نوار کناری',
    'Pinning': 'سنجاق کردن',
    'Show the pin icon on tabs': 'نمایش آیکن سنجاق روی تب‌ها',
    'Close button': 'دکمه بستن',
    'Show the × on hover over tabs': 'نمایش × هنگام عبور نشانگر از روی تب‌ها',
    'Resizable tab width': 'عرض قابل تغییر تب‌ها',
    'Drag the divider to resize (left layout)': 'برای تغییر اندازه، جداکننده را بکش',

    // ---- settings: placeholders ----
    'Detect placeholders': 'تشخیص جایگزین‌ها',
    'Highlight [text] / {text} and offer quick-fill fields': 'هایلایت کردن [متن] / {متن} و ساخت فیلدهای پرکردن سریع',
    'Fill bar position': 'جای نوار پرکردن',
    'Above the prompt, or as a side panel': 'بالای پرامپت، یا به‌صورت پنل کناری',
    'Top': 'بالا',

    // ---- settings: images / AI / voice ----
    'Images': 'تصاویر',
    'AI Chat & actions': 'چت و اکشن‌های هوش مصنوعی',
    'AI features': 'قابلیت‌های هوش مصنوعی',
    'Improve, AI actions, AI Chat and the AI button in Markdown': 'بهبود، اکشن‌های AI، چت و دکمه‌ی AI داخل مارک‌داون',
    'Toolbar buttons': 'دکمه‌های نوار ابزار',

    // ---- settings: system ----
    'Launch at startup': 'اجرا هنگام روشن شدن',
    'Open PromptPad when Windows starts': 'باز شدن پرامپت‌پد با شروع ویندوز',
    'Auto-check for updates': 'بررسی خودکار به‌روزرسانی',
    'Check GitHub for new versions on launch': 'بررسی نسخه‌های جدید در گیت‌هاب هنگام اجرا',
    'Window opacity': 'شفافیت پنجره',
    'Close to tray': 'بستن به سینی سیستم',
    'Keep running in the tray when closed': 'بعد از بستن، در سینی سیستم فعال بماند',
    'Global quick capture': 'ثبت سریع سراسری',
    'Storage': 'محل ذخیره',
    'Open folder': 'باز کردن پوشه',
    'Backup': 'پشتیبان‌گیری',
    'About': 'درباره',
    // ---- support / donation ----
    'Enjoying PromptPad? A small donation keeps it going.':
      'از پرامپت‌پد راضی هستی؟ یک کمک کوچک باعث ادامه‌ی توسعه‌اش می‌شود.',
    'Donate': 'حمایت مالی',
    'Support PromptPad': 'حمایت از پرامپت‌پد',
    'Updated. If PromptPad is useful to you, you can support its development.':
      'به‌روزرسانی شد. اگر پرامپت‌پد برایت مفید است، می‌توانی از توسعه‌اش حمایت کنی.',

    // ---- command palette ----
    'New tab': 'تب جدید',
    'Show tabs': 'نمایش تب‌ها',
    'Hide tabs': 'مخفی کردن تب‌ها',
    'Focus mode': 'حالت تمرکز',
    'Handy mode (dock to edge)': 'حالت دم‌دستی (اتصال به لبه)',
    'Exit handy dock': 'خروج از حالت دم‌دستی',
    'Toggle markdown preview': 'تغییر پیش‌نمایش مارک‌داون',
    'Go to AI Chat': 'رفتن به چت هوش مصنوعی',
    'Clear AI chat': 'پاک کردن چت هوش مصنوعی',
    'Go to': 'رفتن به',

    // ---- Discover & Prompt Lab: nav / tabs ----
    'Browse': 'مرور',
    'Upload': 'بارگذاری',
    'Admin': 'مدیریت',
    'My posts': 'پست‌های من',
    'Logout': 'خروج',
    'Sign in': 'ورود',
    'Register': 'ثبت‌نام',
    'Create account': 'ساخت حساب',
    'Email': 'ایمیل',
    'Username': 'نام کاربری',
    'Password (min 6 chars)': 'رمز عبور (حداقل ۶ نویسه)',
    'Enter an email and a 6+ char password.': 'یک ایمیل و رمز عبور حداقل ۶ نویسه‌ای وارد کن.',
    'Account created — check your email to confirm, then sign in.': 'حساب ساخته شد — ایمیلت را برای تأیید ببین، بعد وارد شو.',
    'Discover isn’t set up yet': 'بخش کشف هنوز راه‌اندازی نشده',

    // ---- categories & sorting ----
    'All': 'همه',
    'Website': 'وب‌سایت',
    'Image': 'تصویر',
    'Music': 'موسیقی',
    'Video': 'ویدیو',
    'Software': 'نرم‌افزار',
    'Game': 'بازی',
    'Other': 'دیگر',
    'Categories': 'دسته‌ها',
    'Category': 'دسته',
    'New': 'جدیدترین',
    'Top': 'برترین',
    'Pending approval': 'در انتظار تأیید',

    // ---- cards & actions ----
    'Copy': 'کپی',
    'Copied': 'کپی شد',
    'Copy ID': 'کپی شناسه',
    'Use': 'استفاده',
    'Use this prompt': 'استفاده از این پرامپت',
    'View': 'بازدید',
    'Edit': 'ویرایش',
    'Edit prompt': 'ویرایش پرامپت',
    'New prompt': 'پرامپت جدید',
    'Save': 'ذخیره',
    'Save changes': 'ذخیره تغییرات',
    'Save to Lab': 'ذخیره در آزمایشگاه',
    'Save to Prompt Lab': 'ذخیره در آزمایشگاه پرامپت',
    'Saved ✓': 'ذخیره شد ✓',
    'Saving…': 'در حال ذخیره…',
    'Share': 'اشتراک',
    'Share to Discover': 'اشتراک در کشف',
    'Sharing…': 'در حال اشتراک‌گذاری…',
    'Report': 'گزارش',
    'Reported ✓': 'گزارش شد ✓',
    'Reporting…': 'در حال گزارش…',
    'Add': 'افزودن',
    '+ Add': '+ افزودن',
    'Delete': 'حذف',
    'Delete post': 'حذف پست',
    'Deleting…': 'در حال حذف…',
    'Open file': 'باز کردن فایل',
    'File ✓': 'فایل ✓',
    'Untitled': 'بدون عنوان',
    'item': 'مورد',
    'items': 'مورد',
    // ---- Discover moderation (posts wait for admin approval) ----
    'pending review': 'در انتظار تأیید',
    'rejected': 'رد شده',
    'Shared — waiting for admin approval': 'اشتراک‌گذاری شد — در انتظار تأیید ادمین',
    "Couldn't open that post": 'باز کردن این پست انجام نشد',
    // ---- admin: new-post notifications ----
    'Someone': 'یک نفر',
    'New post from': 'پست جدید از',
    'PromptPad — new post to review': 'پرامپت‌پد — پست جدید برای بررسی',
    'shared a prompt, pending your approval:': 'یک پرامپت به اشتراک گذاشت، در انتظار تأیید تو:',
    'Posts pending approval': 'پست‌های در انتظار تأیید',
    'Click to see the full post': 'برای دیدن کامل پست کلیک کن',
    'Title': 'عنوان',
    'Prompt': 'پرامپت',
    'Loading…': 'در حال بارگذاری…',
    'Please wait…': 'لطفاً صبر کن…',

    // ---- forms & placeholders ----
    'Search prompts…': 'جست‌وجوی پرامپت‌ها…',
    'Search your prompts…': 'جست‌وجو در پرامپت‌های تو…',
    'Your prompt…': 'پرامپت تو…',
    'Paste your prompt here…': 'پرامپتت را اینجا بچسبان…',
    'A short name': 'یک نام کوتاه',
    'A short name for this prompt': 'یک نام کوتاه برای این پرامپت',
    'Image (optional)': 'تصویر (اختیاری)',
    'Drop an image here, or click to choose': 'یک تصویر اینجا بینداز، یا کلیک کن',
    'Drop, paste, or click to add an image': 'برای افزودن تصویر بینداز، بچسبان یا کلیک کن',
    'Drop / paste / click to replace the image': 'برای جایگزینی تصویر بینداز / بچسبان / کلیک کن',
    'Image added — drop again to replace': 'تصویر اضافه شد — برای جایگزینی دوباره بینداز',
    'Music file (auto-compressed to MP3 ~96 kbps)': 'فایل موسیقی (خودکار به MP3 حدود ۹۶ kbps فشرده می‌شود)',
    'Label (e.g. Video)': 'برچسب (مثلاً ویدیو)',

    // ---- empty states ----
    'No posts yet.': 'هنوز پستی نیست.',
    'No prompts yet. Be the first to share one from the Upload tab.': 'هنوز پرامپتی نیست. اولین نفر باش و از تب بارگذاری یکی به اشتراک بگذار.',
    'You haven’t shared any prompts yet.': 'هنوز هیچ پرامپتی به اشتراک نگذاشته‌ای.',
    'Your Prompt Lab is empty': 'آزمایشگاه پرامپت تو خالی است',
    'Click "+ Add", or just paste an image (Ctrl+V) to create your first prompt.': 'روی «+ افزودن» بزن، یا فقط یک تصویر بچسبان (Ctrl+V) تا اولین پرامپتت ساخته شود.',
    'Nothing matches.': 'چیزی پیدا نشد.',

    // ---- progress & errors ----
    'Compressing image…': 'در حال فشرده‌سازی تصویر…',
    'Preparing music…': 'در حال آماده‌سازی موسیقی…',
    'Uploading image…': 'در حال بارگذاری تصویر…',
    'Uploading music…': 'در حال بارگذاری موسیقی…',
    'Saving image…': 'در حال ذخیره تصویر…',
    'Title and prompt are required.': 'عنوان و پرامپت الزامی است.',
    'Not a valid image': 'تصویر معتبر نیست',
    'Could not process image': 'پردازش تصویر ممکن نشد',
    'Could not save image': 'ذخیره تصویر ممکن نشد',
    'Could not save to Lab.': 'ذخیره در آزمایشگاه ممکن نشد.',
    'Could not report this post.': 'گزارش این پست ممکن نشد.',
    'Music file is too large (max 60 MB).': 'فایل موسیقی خیلی بزرگ است (حداکثر ۶۰ مگابایت).',
    'Music is over 8 MB after compression.': 'موسیقی بعد از فشرده‌سازی بیش از ۸ مگابایت است.',
    'Blocked by the content filter — please remove +18 / offensive words.': 'توسط فیلتر محتوا مسدود شد — لطفاً واژه‌های +۱۸ / توهین‌آمیز را حذف کن.',
    'Blocked by the content filter — remove +18 / offensive words.': 'توسط فیلتر محتوا مسدود شد — واژه‌های +۱۸ / توهین‌آمیز را حذف کن.',
    'Sign in to like': 'برای لایک وارد شو',
    'Sign in to report a post.': 'برای گزارش یک پست وارد شو.',
    'Open the Discover tab and sign in first.': 'اول تب کشف را باز کن و وارد شو.',
    'Delete this prompt from your Lab?': 'این پرامپت از آزمایشگاهت حذف شود؟',
    'Something went wrong.': 'یک جای کار ایراد داشت.',
    'Upload failed.': 'بارگذاری ناموفق بود.',
    'Delete failed.': 'حذف ناموفق بود.',
    'Update failed.': 'به‌روزرسانی ناموفق بود.',
    'Scan failed.': 'اسکن ناموفق بود.',
    'Failed to load.': 'بارگذاری ناموفق بود.',
    'Failed to load reports.': 'بارگذاری گزارش‌ها ناموفق بود.',
    'Failed to load users.': 'بارگذاری کاربران ناموفق بود.',
    'Failed to update user.': 'به‌روزرسانی کاربر ناموفق بود.',
    'Failed to dismiss.': 'رد کردن ناموفق بود.',
    'Could not add category.': 'افزودن دسته ممکن نشد.',
    'Could not read storage.': 'خواندن فضای ذخیره ممکن نشد.',

    // ---- admin ----
    'Users': 'کاربران',
    'Reports': 'گزارش‌ها',
    'No reports. ✓': 'گزارشی نیست. ✓',
    'No users yet.': 'هنوز کاربری نیست.',
    'Approve': 'تأیید',
    'Reject': 'رد',
    'Block': 'مسدود کردن',
    'Unblock': 'رفع مسدودی',
    'Dismiss': 'رد کردن',
    'Image storage': 'فضای تصاویر',
    'Calculating storage…': 'در حال محاسبه فضا…',
    'Orphan files': 'فایل‌های بی‌صاحب',
    'Scan for orphans': 'اسکن فایل‌های بی‌صاحب',
    'Scanning…': 'در حال اسکن…',
    'No orphan files — storage is clean. ✓': 'فایل بی‌صاحبی نیست — فضا تمیز است. ✓',
    'Storage files with no matching post (e.g. from a failed delete).': 'فایل‌هایی که پست متناظر ندارند (مثلاً از یک حذف ناموفق).'
  };

  const TABLES = { en: {}, fa: FA };

  // Containers whose text is the user's own content — never translated.
  // Card titles and prompt bodies in Discover / Prompt Lab are user-written too
  // — a prompt titled "Copy" must not become "کپی".
  // Profile names are user content: a profile called "Settings" or "new" would
  // otherwise get swapped for its Persian translation. That covers the chip,
  // the switcher rows, the move/copy pickers (.ctx-profile-list — those hold
  // nothing but names) and the toast's name span, whose message half sits in a
  // sibling and is translated normally.
  const SKIP_SELECTORS = '#editor, #mdPreview, #tabList, #fsMessages, #aiMessages, ' +
    '.md-block-edit, .dc-card-title, .dc-card-prompt, .dc-mod-title, ' +
    '#profileChipName, .profile-menu-name, #profileDeleteText, ' +
    '.ctx-profile-list, .toast-name, ' +
    // shared notes: usernames and note titles, which must never be "translated"
    '.share-person-name, .share-note, .invite-text, .collab-people';

  const originals = new WeakMap();   // node/attr key -> original English
  let applying = false;

  function lookup(lang, s) {
    const table = TABLES[lang];
    if (!table) return null;
    const key = s.trim();
    if (!key) return null;
    const hit = table[key];
    if (!hit) return null;
    // preserve the surrounding whitespace of the original text node
    return s.replace(key, hit);
  }

  function attrKey(el, name) {
    let bag = originals.get(el);
    if (!bag) { bag = {}; originals.set(el, bag); }
    return bag;
  }

  const ATTRS = ['title', 'placeholder', 'data-placeholder', 'aria-label'];

  // Both translators return how many things they actually rewrote — the caller
  // uses that to know when the DOM has converged (see applyLanguage).
  function translateElement(el, lang) {
    const bag = attrKey(el);
    let changed = 0;
    ATTRS.forEach((name) => {
      const cur = el.getAttribute(name);
      if (cur === null && bag[name] === undefined) return;
      if (bag[name] === undefined) bag[name] = cur;
      const src = bag[name];
      if (src === null || src === undefined) return;
      const out = lang === 'en' ? src : (lookup(lang, src) || src);
      if (el.getAttribute(name) !== out) { el.setAttribute(name, out); changed++; }
    });
    return changed;
  }

  function translateTextNode(node, lang) {
    const bag = originals.get(node);
    const src = bag === undefined ? node.nodeValue : bag.text;
    if (bag === undefined) originals.set(node, { text: node.nodeValue });
    const out = lang === 'en' ? src : (lookup(lang, src) || src);
    if (node.nodeValue === out) return 0;
    node.nodeValue = out;
    return 1;
  }

  function applyLanguage(lang) {
    if (applying) return 0;
    applying = true;
    let changed = 0;
    try {
      const root = document.body;
      if (!root) return 0;
      const skip = Array.from(root.querySelectorAll(SKIP_SELECTORS));
      const inSkipped = (n) => skip.some((s) => s.contains(n));
      // A skipped container's own attributes are still UI chrome (the editor's
      // placeholder, for instance) — only its contents are the user's.
      const attrsSkipped = (el) => skip.some((s) => s !== el && s.contains(el));

      root.querySelectorAll('*').forEach((el) => {
        if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') return;
        if (attrsSkipped(el)) return;
        changed += translateElement(el, lang);
      });

      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const texts = [];
      let n;
      while ((n = walker.nextNode())) {
        if (!n.nodeValue || !n.nodeValue.trim()) continue;
        const p = n.parentElement;
        if (!p || p.tagName === 'SCRIPT' || p.tagName === 'STYLE') continue;
        if (inSkipped(n)) continue;
        texts.push(n);
      }
      texts.forEach((t) => { changed += translateTextNode(t, lang); });

      document.documentElement.lang = lang;
    } finally {
      applying = false;
    }
    return changed;
  }

  // Single string lookup for text built in JS. `key` is kept for readability at
  // the call site; the translation is resolved from the English source string.
  function translate(lang, en) {
    if (lang === 'en') return en;
    return lookup(lang, en) || en;
  }

  window.PP_I18N = {
    tables: TABLES,
    applyLanguage,
    translate,
    isApplying: () => applying
  };
})();
