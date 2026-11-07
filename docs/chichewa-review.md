# Chichewa (Chinyanja) Translation Review Guide
**Status:** NEEDS NATIVE REVIEW  
**Locale:** Lilongwe, Malawi (`ny` / Chichewa)  
**Target Audience:** Urban riders, moto/tuk-tuk/cab drivers, and corporate parcel senders across the Lilongwe corridor.

---

## 1. Brand Identity & Taglines

| Key | English Source | Chichewa Draft (`shared/i18n.js`) | Review Status | Notes for Native Reviewer |
| :--- | :--- | :--- | :--- | :--- |
| `brandTagline` | Rise • Build • Grow | **Uka • Manga • Kula** | ⚠️ Needs Review | Evaluated literal translation of *Rise* (Uka), *Build* (Manga), *Grow* (Kula). Verify colloquial resonance for modern mobility. |
| `tagline` | Rise • Build • Grow • Lilongwe | **Uka • Manga • Kula • Lilongwe** | ⚠️ Needs Review | Used across splash, login headers, and web manifest descriptions. |

---

## 2. Rider Booking & Navigation Tabs

| Key | English Source | Chichewa Draft (`shared/i18n.js`) | Review Status | Notes for Native Reviewer |
| :--- | :--- | :--- | :--- | :--- |
| `navActivity` | Activity | **Ntchito** | ⚠️ Needs Review | Bottom navigation tab representing ride history and past trips. Alternates: *Zochitika*, *Mbiri ya Maulendo*. |
| `navAccount` | Account | **Akaunti** | ⚠️ Needs Review | Bottom navigation tab representing rider/driver profile and settings. |
| `useCurrentLocation`| Use current location | **Gwiritsani ntchito komwe muli pompano** | ⚠️ Needs Review | Button in search planner to trigger device GPS lookup. |
| `simulateLocation` | Simulate Lilongwe location (Dev) | **Yesani malo a Lilongwe (Dev)** | ⚠️ Needs Review | Development/testing fallback trigger. |
| `viaStopLabel` | Via Stop | **Poyimilira Podutsa** | ⚠️ Needs Review | Multi-stop planner intermediate stop field label. |
| `addStopBtn` | + Add Stop | **+ Onjezani Poyimilira** | ⚠️ Needs Review | Action button to add up to 2 intermediate route stops. |
| `removeStopBtn` | Remove | **Chotsani** | ⚠️ Needs Review | Action button to remove an intermediate stop. |

---

## 3. Device Geolocation & GPS Diagnostic Alerts

| Key | English Source | Chichewa Draft (`shared/i18n.js`) | Review Status | Notes for Native Reviewer |
| :--- | :--- | :--- | :--- | :--- |
| `gpsDeniedMsg` | Location permission denied. Please allow location access in your browser or search your pickup. | **Malo sanaloledwe. Chonde lolani malo mu msakatuli mwanu kapena fufuzani pamanja.** | ⚠️ Needs Review | Toast/alert shown when browser geolocation is denied by the user. |
| `gpsUnavailableMsg` | Location unavailable. Please check your GPS signal or search your pickup. | **Malo sakupezeka. Chonde yang'anani chizindikiro cha GPS.** | ⚠️ Needs Review | Hardware GPS fix unavailable (e.g. underground or weak satellite fix). |
| `gpsTimeoutMsg` | GPS request timed out. Please try again or drag the pin on the map. | **Nthawi ya GPS yapita. Chonde yesaninso kapena lembani pamanja.** | ⚠️ Needs Review | High accuracy 10-second GPS acquisition timeout. |
| `gpsInsecureMsg` | Geolocation requires a secure connection (HTTPS). Please search your location manually. | **Kupeza malo kumafuna kulumikizana kotetezeka (HTTPS).** | ⚠️ Needs Review | Browser restriction when accessing site over plain HTTP. |

---

## 4. Legal Compliance, Safety Notices & Consent

| Key | English Source | Chichewa Draft (`shared/i18n.js`) | Review Status | Notes for Native Reviewer |
| :--- | :--- | :--- | :--- | :--- |
| `prohibitedNotice` | I confirm the package contains no weapons, drugs, cash, or hazardous items. | **Ndikuvomereza kuti phukuloli mulibe zida, mankhwala osokoneza, ndalama kapena zinthu zoopsa.** | ⚠️ Needs Review | Legal declaration checkbox for courier parcel dispatch. |
| `termsNotice` | I agree to the Terms of Service & Privacy Policy | **Ndikuvomera Migwirizano Yantchito & Mfundo Zachinsinsi** | ⚠️ Needs Review | Onboarding & registration terms acceptance checkbox. |
| `driverAgreementNotice` | I agree to the 30% commission, debt limit, and document verification policy | **Ndikuvomera komishoni ya 30%, malire a ngongole, ndi ndondomeko ya zikalata** | ⚠️ Needs Review | Driver partner onboarding terms acceptance. |

---

## 5. SMS Delivery Failure & Retry Messaging

| Key | English Source | Chichewa Draft (`shared/i18n.js`) | Review Status | Notes for Native Reviewer |
| :--- | :--- | :--- | :--- | :--- |
| `smsDeliveryFailedTitle` | Unable to Send Code | **Sizingatheke Kutumiza Khodi** | ⚠️ Needs Review | Modal header when SMS delivery fails or carrier network rejects. |
| `smsDeliveryFailedMsg` | SMS delivery failed. Please check your network or try again later. | **Kutumiza uthenga walephereka. Chonde onetsetsani kuti muli ndi netiweki kapena yesaninso nthawi ina.** | ⚠️ Needs Review | Error toast/alert advising user to retry when telecom network recovers. |
| `tryAgainLaterBtn` | Try Again Later | **Yesaninso Pambuyo** | ⚠️ Needs Review | Action button on error dialog. |

---

## 6. Reviewer Sign-Off Checklist
- [ ] Tagline conveys optimism and forward progress in colloquial Chichewa.
- [ ] Technical concepts (GPS, HTTPS, Account, Activity) use natural terms rather than cumbersome loan-word constructs.
- [ ] Legal warnings are clear, binding, and easily understood by both urban and peri-urban users.

## Consent wording (added with the explicit consent checkbox) — NEEDS NATIVE REVIEW + LAWYER
Keys in `shared/i18n.js`: `consentLead`, `consentTerms`, `consentAnd`, `consentPrivacy`, `consentRequired`,
`driverAgreementText`, `driverAgreementRequired`. The Chichewa text is a first draft and must be checked by a
Chichewa speaker and by the lawyer, because it is the wording people agree to.
