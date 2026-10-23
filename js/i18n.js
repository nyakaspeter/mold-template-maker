// English text is the key; German and Hungarian translations. {name} marks a value filled in at run time.
export const I18N = {
  de: {
    'Picture type': 'Bildart', 'Auto': 'Automatisch', 'Auto ({type})': 'Automatisch ({type})',
    'Height map': 'Höhenkarte', 'Line art / sketch': 'Strichzeichnung / Skizze', 'Flat cartoon': 'Flacher Cartoon',
    'Shaded render / painting': 'Schattiertes Rendering / Gemälde',
    'What kind of picture this is; it decides how it is turned into 3D. Auto guesses; pick another type if the guess is wrong.':
      'Welche Art Bild das ist; davon hängt ab, wie es zu 3D wird. Automatisch rät; wähle eine andere Art, wenn die Vermutung falsch ist.',
    'Depth model': 'Tiefenmodell',
    'Which AI model estimates depth. 1 is the smallest (about 50 MB to download once); 2 and 3 are larger (about 195 MB each) and can give somewhat better depth.':
      'Welches KI-Modell die Tiefe schätzt. 1 ist das kleinste (einmalig ca. 50 MB Download); 2 und 3 sind größer (je ca. 195 MB) und können etwas bessere Tiefe liefern.',
    'Size': 'Größe', 'Outline': 'Umriss', 'Relief': 'Relief', 'Final object': 'Endobjekt', 'Mold template': 'Formvorlage',
    'Object width': 'Objektbreite', 'Scale': 'Maßstab', 'Which side faces up': 'Welche Seite zeigt nach oben',
    '+Z (normal)': '+Z (normal)', '−Z (upside down)': '−Z (kopfüber)',
    'Detail (cell size)': 'Detail (Zellgröße)', 'Smaller = finer detail, slower.': 'Kleiner = feinere Details, langsamer.',
    'Background tolerance': 'Hintergrundtoleranz',
    'Raise it if bits of background stay attached, lower it if pale parts of the figure disappear.':
      'Erhöhen, wenn Reste vom Hintergrund hängen bleiben; verringern, wenn helle Teile der Figur verschwinden.',
    'Close outline gaps': 'Umrisslücken schließen',
    "Bridges small breaks in an outline so the background can't leak in.":
      'Überbrückt kleine Lücken im Umriss, damit der Hintergrund nicht hineinläuft.',
    'Open gaps between parts': 'Lücken zwischen Teilen öffnen',
    'Removes enclosed background, like the space between legs. Higher opens more, 0 keeps everything filled.':
      'Entfernt eingeschlossenen Hintergrund, z. B. zwischen den Beinen. Höher öffnet mehr, 0 lässt alles gefüllt.',
    'Outline smoothing': 'Umrissglättung',
    'Colour area tolerance': 'Farbflächentoleranz',
    'Lower = more, smaller areas (more detail). Higher = merges shading.':
      'Niedriger = mehr, kleinere Flächen (mehr Details). Höher = fasst Schattierungen zusammen.',
    'Smooth out texture': 'Textur glätten',
    'Evens out paint texture and pencil shading before splitting into areas.':
      'Gleicht Maltextur und Bleistiftschattierung aus, bevor in Flächen aufgeteilt wird.',
    'Depth range': 'Tiefenbereich', 'Puff (roundness)': 'Wölbung',
    'How much each part bulges, like a cushion.': 'Wie stark sich jedes Teil wölbt, wie ein Kissen.',
    'Line grooves': 'Linienrillen', 'Presses dark outlines of a drawing in as grooves.': 'Drückt dunkle Umrisslinien einer Zeichnung als Rillen ein.',
    'Line darkness': 'Liniendunkelheit',
    'How dark a stroke must be to count as a line. Raise it for pencil sketches.':
      'Wie dunkel ein Strich sein muss, um als Linie zu zählen. Für Bleistiftskizzen erhöhen.',
    'Colour edge grooves': 'Farbkantenrillen',
    'Grooves where colours meet: eyes, mouth, stripes. For images without outlines.':
      'Rillen, wo Farben aufeinandertreffen: Augen, Mund, Streifen. Für Bilder ohne Umrisslinien.',
    'Surface detail': 'Oberflächendetail',
    'Light parts slightly raised, dark parts slightly lowered.': 'Helle Teile leicht erhöht, dunkle leicht vertieft.',
    'Relief curve': 'Reliefkurve', '<1 puffs it up, >1 flattens the low parts.': '<1 wölbt es auf, >1 flacht die niedrigen Teile ab.',
    'Relief smoothing': 'Reliefglättung', 'Edge rounding': 'Kantenrundung',
    'Back thickness': 'Rückenstärke', 'Flat-sided base under the relief.': 'Gerader Sockel unter dem Relief.',
    'Flat border around shape': 'Flacher Rand um die Form',
    'Adds a flat plaque rim around the outline.': 'Fügt einen flachen Plakettenrand um den Umriss hinzu.',
    'Gap (= silicone rim width)': 'Spalt (= Breite des Silikonrands)', 'Silicone above highest point': 'Silikon über dem höchsten Punkt',
    'Wall thickness': 'Wandstärke', 'Base thickness': 'Bodenstärke',
    'Reset to default': 'Auf Standard zurücksetzen', 'Reset {label}': '{label} zurücksetzen',
    'Browse for an image or STL': 'Bild oder STL auswählen', 'No file loaded': 'Keine Datei geladen', 'Language': 'Sprache',
    'Image': 'Bild', 'Object': 'Objekt', 'Template': 'Vorlage', 'Mold': 'Form',
    'Show colours': 'Farben anzeigen', 'Reset view': 'Ansicht zurücksetzen',
    'Brush size': 'Pinselgröße', 'Undo last stroke': 'Letzten Strich rückgängig machen', 'Reset outline': 'Umriss zurücksetzen',
    'Drop an image or STL here': 'Bild oder STL hier ablegen', 'or click to choose a file': 'oder klicken, um eine Datei auszuwählen',
    'Or try a demo:': 'Oder eine Demo ausprobieren:', 'Drop to load': 'Zum Laden loslassen', 'Working out the outline': 'Umriss wird ermittelt',
    'Darkened parts are left out. Paint to light up what belongs to the object; hold {shift} while painting to darken what doesn\'t. Applied when you switch stage.':
      'Abgedunkelte Teile werden weggelassen. Male, um aufzuhellen, was zum Objekt gehört; halte beim Malen {shift} gedrückt, um abzudunkeln, was nicht dazugehört. Wird beim Wechseln der Ansicht übernommen.',
    'Shift': 'Umschalt',
    '{size} · about {ml} ml of casting material': '{size} · ca. {ml} ml Gießmasse',
    '{size} · needs about {ml} ml (≈ {g} g) of silicone': '{size} · benötigt ca. {ml} ml (≈ {g} g) Silikon',
    '{size} · holds about {ml} ml': '{size} · fasst ca. {ml} ml',
    'Download object STL': 'Objekt-STL herunterladen', 'Download template STL': 'Vorlagen-STL herunterladen', 'Download mold STL': 'Form-STL herunterladen',
    'Updating…': 'Aktualisiere…', 'Built in {ms} ms': 'Fertig in {ms} ms', 'Loading depth model…': 'Lade Tiefenmodell…',
    'Downloading depth model… {p}%': 'Lade Tiefenmodell herunter… {p} %', 'Estimating depth…': 'Schätze Tiefe…',
    'AI depth failed — continuing without it. ': 'KI-Tiefenschätzung fehlgeschlagen – weiter ohne. ',
    'Could not read that file: ': 'Datei konnte nicht gelesen werden: ',
    'No shape found — try another background tolerance.': 'Keine Form gefunden – versuche eine andere Hintergrundtoleranz.',
  },
  hu: {
    'Picture type': 'Kép típusa', 'Auto': 'Automatikus', 'Auto ({type})': 'Automatikus ({type})',
    'Height map': 'Magasságtérkép', 'Line art / sketch': 'Vonalrajz / vázlat', 'Flat cartoon': 'Sima színezésű rajz',
    'Shaded render / painting': 'Árnyalt render / festmény',
    'What kind of picture this is; it decides how it is turned into 3D. Auto guesses; pick another type if the guess is wrong.':
      'Milyen fajta kép ez; ettől függ, hogyan lesz belőle 3D. Az automatikus becsül; válassz másikat, ha téves.',
    'Depth model': 'Mélységmodell',
    'Which AI model estimates depth. 1 is the smallest (about 50 MB to download once); 2 and 3 are larger (about 195 MB each) and can give somewhat better depth.':
      'Melyik AI-modell becsüli a mélységet. Az 1-es a legkisebb (egyszeri kb. 50 MB letöltés); a 2-es és 3-as nagyobb (egyenként kb. 195 MB), és valamivel jobb mélységet adhat.',
    'Size': 'Méret', 'Outline': 'Körvonal', 'Relief': 'Dombormű', 'Final object': 'Kész tárgy', 'Mold template': 'Öntőforma-sablon',
    'Object width': 'Tárgy szélessége', 'Scale': 'Méretarány', 'Which side faces up': 'Melyik oldal néz felfelé',
    '+Z (normal)': '+Z (normál)', '−Z (upside down)': '−Z (fejjel lefelé)',
    'Detail (cell size)': 'Részletesség (cellaméret)', 'Smaller = finer detail, slower.': 'Kisebb = finomabb részletek, lassabb.',
    'Background tolerance': 'Háttértűrés',
    'Raise it if bits of background stay attached, lower it if pale parts of the figure disappear.':
      'Növeld, ha háttérdarabok maradnak a figurán; csökkentsd, ha a figura világos részei eltűnnek.',
    'Close outline gaps': 'Körvonalrések zárása',
    "Bridges small breaks in an outline so the background can't leak in.":
      'Áthidalja a körvonal kisebb szakadásait, hogy a háttér ne folyjon be.',
    'Open gaps between parts': 'Rések nyitása a részek között',
    'Removes enclosed background, like the space between legs. Higher opens more, 0 keeps everything filled.':
      'Eltávolítja a körbezárt hátteret, például a lábak közötti részt. Nagyobb érték többet nyit, 0 mindent kitöltve hagy.',
    'Outline smoothing': 'Körvonal simítása',
    'Colour area tolerance': 'Színfolt-tűrés',
    'Lower = more, smaller areas (more detail). Higher = merges shading.':
      'Kisebb = több, kisebb terület (több részlet). Nagyobb = összevonja az árnyalatokat.',
    'Smooth out texture': 'Textúra kisimítása',
    'Evens out paint texture and pencil shading before splitting into areas.':
      'Kiegyenlíti a festék textúráját és a ceruzás árnyékolást, mielőtt területekre bontja.',
    'Depth range': 'Mélységtartomány', 'Puff (roundness)': 'Domborúság',
    'How much each part bulges, like a cushion.': 'Mennyire domborodik ki egy-egy rész, mint egy párna.',
    'Line grooves': 'Vonalbarázdák', 'Presses dark outlines of a drawing in as grooves.': 'A rajz sötét körvonalait barázdaként nyomja be.',
    'Line darkness': 'Vonalsötétség',
    'How dark a stroke must be to count as a line. Raise it for pencil sketches.':
      'Milyen sötétnek kell lennie egy vonásnak, hogy vonalnak számítson. Ceruzavázlatoknál növeld.',
    'Colour edge grooves': 'Színhatár-barázdák',
    'Grooves where colours meet: eyes, mouth, stripes. For images without outlines.':
      'Barázdák ott, ahol a színek találkoznak: szem, száj, csíkok. Körvonal nélküli képekhez.',
    'Surface detail': 'Felületi részletek',
    'Light parts slightly raised, dark parts slightly lowered.': 'A világos részek kissé kiemelkednek, a sötétek kissé besüllyednek.',
    'Relief curve': 'Domborműgörbe', '<1 puffs it up, >1 flattens the low parts.': '<1 felfújja, >1 lelapítja az alacsony részeket.',
    'Relief smoothing': 'Dombormű simítása', 'Edge rounding': 'Élkerekítés',
    'Back thickness': 'Hátlap vastagsága', 'Flat-sided base under the relief.': 'Egyenes oldalú alap a dombormű alatt.',
    'Flat border around shape': 'Lapos szegély a forma körül',
    'Adds a flat plaque rim around the outline.': 'Lapos plakettperemet ad a körvonal köré.',
    'Gap (= silicone rim width)': 'Rés (= a szilikonperem szélessége)', 'Silicone above highest point': 'Szilikon a legmagasabb pont felett',
    'Wall thickness': 'Falvastagság', 'Base thickness': 'Alapvastagság',
    'Reset to default': 'Alapértékre állítás', 'Reset {label}': '{label} alapértékre állítása',
    'Browse for an image or STL': 'Kép vagy STL tallózása', 'No file loaded': 'Nincs betöltött fájl', 'Language': 'Nyelv',
    'Image': 'Kép', 'Object': 'Tárgy', 'Template': 'Sablon', 'Mold': 'Öntőforma',
    'Show colours': 'Színek mutatása', 'Reset view': 'Nézet visszaállítása',
    'Brush size': 'Ecsetméret', 'Undo last stroke': 'Utolsó vonás visszavonása', 'Reset outline': 'Körvonal visszaállítása',
    'Drop an image or STL here': 'Húzz ide egy képet vagy STL-t', 'or click to choose a file': 'vagy kattints egy fájl kiválasztásához',
    'Or try a demo:': 'Vagy próbálj ki egy demót:', 'Drop to load': 'Engedd el a betöltéshez', 'Working out the outline': 'A körvonal meghatározása',
    'Darkened parts are left out. Paint to light up what belongs to the object; hold {shift} while painting to darken what doesn\'t. Applied when you switch stage.':
      'A sötétített részek kimaradnak. Fess rá, hogy kivilágítsd, ami a tárgyhoz tartozik; festés közben tartsd lenyomva a {shift} billentyűt, hogy elsötétítsd, ami nem. Nézetváltáskor lép érvénybe.',
    'Shift': 'Shift',
    '{size} · about {ml} ml of casting material': '{size} · kb. {ml} ml öntőanyag',
    '{size} · needs about {ml} ml (≈ {g} g) of silicone': '{size} · kb. {ml} ml (≈ {g} g) szilikon kell hozzá',
    '{size} · holds about {ml} ml': '{size} · kb. {ml} ml fér bele',
    'Download object STL': 'Tárgy STL letöltése', 'Download template STL': 'Sablon STL letöltése', 'Download mold STL': 'Öntőforma STL letöltése',
    'Updating…': 'Frissítés…', 'Built in {ms} ms': 'Elkészült {ms} ms alatt', 'Loading depth model…': 'Mélységmodell betöltése…',
    'Downloading depth model… {p}%': 'Mélységmodell letöltése… {p}%', 'Estimating depth…': 'Mélység becslése…',
    'AI depth failed — continuing without it. ': 'Az AI-mélységbecslés nem sikerült – folytatás nélküle. ',
    'Could not read that file: ': 'Nem sikerült beolvasni a fájlt: ',
    'No shape found — try another background tolerance.': 'Nem található forma – próbálj más háttértűrést.',
  },
};
export const LANGS = [['en', 'English'], ['de', 'Deutsch'], ['hu', 'Magyar']];
export const FLAGS = {
  en: '<svg viewBox="0 0 60 30" preserveAspectRatio="none"><clipPath id="ukc"><path d="M30 15h30v15zv15H0zH0V0zV0h30z"/></clipPath>' +
    '<path d="M0 0v30h60V0z" fill="#012169"/><path d="M0 0l60 30m0-30L0 30" stroke="#fff" stroke-width="6"/>' +
    '<path d="M0 0l60 30m0-30L0 30" clip-path="url(#ukc)" stroke="#C8102E" stroke-width="4"/>' +
    '<path d="M30 0v30M0 15h60" stroke="#fff" stroke-width="10"/><path d="M30 0v30M0 15h60" stroke="#C8102E" stroke-width="6"/></svg>',
  de: '<svg viewBox="0 0 3 3" preserveAspectRatio="none"><path fill="#000" d="M0 0h3v1H0z"/><path fill="#DD0000" d="M0 1h3v1H0z"/><path fill="#FFCE00" d="M0 2h3v1H0z"/></svg>',
  hu: '<svg viewBox="0 0 3 3" preserveAspectRatio="none"><path fill="#CD2A3E" d="M0 0h3v1H0z"/><path fill="#fff" d="M0 1h3v1H0z"/><path fill="#436F4D" d="M0 2h3v1H0z"/></svg>',
};
let LANG = (() => {
  try { const saved = localStorage.getItem('lang'); if (I18N[saved] || saved === 'en') return saved; } catch (e) { /* storage blocked */ }
  const nav = (navigator.language || 'en').slice(0, 2);
  return I18N[nav] ? nav : 'en';
})();
export function t(s, vars) {
  let r = (I18N[LANG] && I18N[LANG][s]) || s;
  if (vars) r = r.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  return r;
}

export const getLang = () => LANG;
export function setLang(lang) { LANG = lang; }
