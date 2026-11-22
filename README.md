# Nilamova Ad Blocker (v1.2)

Chrome / Edge ke liye free ad blocker.

## Kya kya karta hai
- Ads, trackers, cookie banners, anti-adblock message block/hide
- Bina click ke khulne wale popups aur ad wale naye tabs band
- YouTube: video ads ka data player tak pahunchne se pehle hata deta hai (ad shuru hi nahi hota), bache ads turant skip, Shorts ads skip, "ad blocker band karo" popup hatata hai, feed/search ke ads hide
- Khatarnak (malware/scam) sites se pehle warning page
- Element picker: kisi bhi ad par click karke hamesha ke liye hatao
- Site whitelist, on/off button, counter, total stats
- Hindi + English popup

## Apne laptop par chalana (test)
1. Zip extract karo
2. Chrome mein `chrome://extensions` kholo
3. Upar right mein **Developer mode** on karo
4. **Load unpacked** dabao, phir `adblocker` folder chuno

## Apni details bharna
`config.js` kholo:
- `DONATE_URL` mein apna donation page link daalo (khali raha to button nahi dikhega)
- `REPORT_URL` mein apne GitHub repo ka link daalo

## Filter lists update karna (har 2-4 hafte)
```
python3 build/build_filters.py <lists_folder>
```
`<lists_folder>` mein ye files honi chahiye: easylist.txt, easyprivacy.txt, fanboy-annoyance.txt,
antiadblock_english.txt, uBlock ki filters.txt, quick-fixes.txt, badware.txt, annoyances-cookies.txt.
Phir `manifest.json` mein version badhao aur Web Store par naya zip upload karo.

## Publish
- Chrome Web Store: $5 one-time fee, privacy policy ka link chahiye (pages/privacy.html ko GitHub Pages par daal do)
- Edge Add-ons: free

`build/` folder sirf update ke liye hai, upload zip mein na bhi ho to chalega.
