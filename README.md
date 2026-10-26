# Teamplanner Jeugdvoetbal

Een web-app voor coaches van jeugdteams. Hij werkt op telefoon en computer en je kunt hem op je beginscherm zetten.

- **Spelers** met hun posities, en per gezin wat de ouders kunnen doen: rijden (met het aantal plekken), grensrechter en wassen.
- **Wedstrijden** invoeren of in één keer plakken vanaf de clubsite. De app rekent de verzameltijd uit (standaard 45 minuten voor de aftrap) en bij uitwedstrijden hoe laat je vanaf de thuisclub vertrekt.
- **Taakschema**: met één knop eerlijk verdeeld over het seizoen, rekening houdend met afwezigen en wat ieder gezin kan.
- **Wisselschema** per wedstrijd met posities. Kinderen met de minste speelminuten krijgen voorrang, zodat iedereen over het seizoen ongeveer even veel speelt.
- **Kijklink voor ouders**: zij zien de tijden en taken, maar kunnen niets wijzigen.
- Elke coach logt in met zijn e-mailadres en kan meerdere teams beheren.

## Hoe het werkt

Het is een statische website (HTML, CSS en JavaScript, zonder build-stap) die via GitHub Pages online staat. De gegevens staan in [Supabase](https://supabase.com), een gratis online database. Is Supabase niet ingesteld, dan werkt de app ook, maar blijven de gegevens in de browser.

| Bestand | Wat |
|---|---|
| `index.html` | De pagina |
| `js/app.js` | De app: schermen, planner voor taken en wissels, opslag |
| `js/config.js` | Adres en publieke sleutel van je Supabase-project |
| `css/style.css` | Opmaak (licht en donker) |
| `supabase/schema.sql` | Tabel, beveiliging en de functie voor de kijklink |

## Installeren (één keer)

### 1. Supabase
1. Maak een gratis account op supabase.com en een nieuw project (regio Frankfurt).
2. Open **SQL Editor → New query**, plak de inhoud van `supabase/schema.sql` en klik op **Run**.
3. Ga naar **Authentication → URL Configuration**:
   - *Site URL*: `https://jfolmer-create.github.io/jeugd-sport-coach-/`
   - *Redirect URLs*: voeg hetzelfde adres toe.
4. Optioneel, maar handig op de telefoon: ga naar **Authentication → Emails → Magic Link** en zet `Je code: {{ .Token }}` in de mail. Dan kun je ook inloggen met de code in plaats van de link.
5. Kopieer bij **Project Settings → API** de *Project URL* en de *anon / publishable key* naar `js/config.js`. Gebruik nooit de *service_role* of *secret* key: die geeft volledige toegang.

### 2. GitHub Pages
In de repository: **Settings → Pages → Build and deployment → Deploy from a branch**, kies `main` en `/ (root)`. Na een minuut staat de app op `https://jfolmer-create.github.io/jeugd-sport-coach-/`.

## Privacy
- Een coach ziet alleen zijn eigen teams (Row Level Security in Supabase).
- De kijklink bevat een lang willekeurig token. Wie de link heeft, ziet de wedstrijden, tijden, taken en voornamen, maar niet de wisselschema's of speelminuten. Via Instellingen maak je een nieuwe link; de oude werkt dan niet meer.
- Supabase verstuurt zelf maar een paar inlogmails per uur. Gaan veel coaches de app gebruiken, stel dan eigen SMTP in bij **Authentication → Emails**.

## Lokaal draaien
Elke eenvoudige webserver werkt, bijvoorbeeld `python3 -m http.server` in deze map. Open daarna http://localhost:8000.
