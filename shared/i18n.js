// AArohan Urban Mobility • Internationalization & Localization Engine
// Bilingual English (EN) & Chichewa (NY) for Lilongwe, Malawi

(function(window) {
  'use strict';

  const STORAGE_KEY = 'aarohan_language';

  const translations = {
    en: {
      appName: 'Aarohan Malawi',
      brandTagline: 'Rise • Build • Grow',
      tagline: 'Rise • Build • Grow • Lilongwe',
      liveBadge: 'Live Real-Time',
      walletHeader: 'Wallet',
      whereTo: 'Where to in Lilongwe?',
      searchPlaceholder: 'Type Area 10, Area 18, Area 49, Lumbadzi, EPTL...',
      pickupLabel: 'Pickup',
      destinationLabel: 'Destination',
      viaStopLabel: 'Via Stop',
      addStopBtn: '+ Add Stop',
      removeStopBtn: 'Remove',
      popularPlaces: 'Popular Lilongwe Locations',
      customPickup: 'Custom Pickup Street or Landmark',
      useGps: 'Use Live Device GPS Pin',
      routeSummary: 'Server Guaranteed Quote',
      bookMoto: 'Book Aarohan Moto',
      bookAuto: 'Book Aarohan Auto',
      bookCab: 'Book Aarohan Cab',
      rideNow: 'Ride Now',
      scheduleLater: 'Schedule Later',
      scheduleModalTitle: 'Schedule Lilongwe Ride',
      scheduleModalSub: 'Pre-book early morning flights or airport transfers',
      selectDate: 'Select Pickup Date',
      selectTime: 'Select Pickup Time',
      confirmSchedule: 'Confirm Scheduled Ride',
      scheduledNotice: 'Scheduled Ride Active',
      surgeBadge: 'Surge Demand Active',
      toggleHeatmap: 'Surge Heatmap',
      safetyShield: 'Safety Shield',
      audioShieldActive: 'Encrypted Audio Shield Active',
      deviationAlertTitle: 'Route Deviation Detected',
      deviationAlertSub: 'Your vehicle has diverged from the recommended Kaunda Rd / M1 corridor.',
      iAmSafe: 'I am Safe (Driver Detour)',
      alertPolice: 'Alert Police (997) & Desk',
      captainApproaching: 'Captain is approaching',
      captainArrived: 'Captain Has Arrived!',
      showPinToCaptain: 'Show PIN {pin} to Captain {name}',
      startRidePinVerified: 'Captain Verified PIN • Start Ride',
      inTransitTo: 'In Transit to {dest}',
      tripCompletedTitle: 'Arrived at Destination!',
      tripCompletedSub: 'Trip Completed • Escrow Released',
      receiptEscrowSub: '70% settled to Captain • 30% Aarohan Platform',
      rateCaptain: 'Rate Your Captain',
      selectTip: 'Add Driver Gratuity (100% to Captain)',
      doneBookAnother: 'Done / Book Another Ride',
      navRide: 'Ride',
      navOwnly: 'Ownly',
      navParcel: 'Parcel',
      navTravel: 'Travel',
      navProfile: 'Profile',
      rentalsTitle: 'Aarohan Ownly Self-Drive',
      rentalsSub: 'Hourly and daily vehicle rentals across Lilongwe.',
      rentBtn: 'Rent Vehicle',
      parcelTitle: 'Aarohan Parcel Delivery',
      parcelSub: 'Fast courier for documents, packages & food across Lilongwe.',
      dispatchParcel: 'Dispatch Parcel Courier',
      travelTitle: 'Aarohan Intercity Travel',
      travelSub: 'Comfortable outstation cabs & shuttles across Malawi.',
      bookIntercity: 'Book Intercity Journey',
      walletTitle: 'Aarohan Kwacha Wallet',
      topUpBtn: 'Top Up (Airtel/TNM)',
      sendKwachaBtn: 'Send Kwacha',
      recentTx: 'Recent Transactions',
      savedPlaces: 'Saved Places in Lilongwe',
      loginTitle: 'Sign In to Aarohan',
      loginSub: 'Fast, secure urban mobility in Lilongwe',
      phoneLabel: 'Malawian Mobile Number',
      requestOtpBtn: 'Send Verification Code',
      otpTitle: 'Verify Your Phone',
      otpSub: 'Enter the 6-digit code sent to {phone}',
      otpLabel: '6-Digit SMS Code',
      verifyOtpBtn: 'Verify & Continue',
      changePhoneBtn: 'Change Phone',
      logoutBtn: 'Log Out',
      driverPendingTitle: 'Application Under Review',
      driverPendingSub: 'Your driver partner profile is pending verification by Aarohan operations in Lilongwe.',
      adminLoginTitle: 'Operations Desk Access',
      adminPasswordLabel: 'Admin Password',
      adminLoginBtn: 'Verify & Sign In',
      smsDeliveryFailedTitle: 'Unable to Send Code',
      smsDeliveryFailedMsg: 'SMS delivery failed. Please check your network or try again later.',
      tryAgainLaterBtn: 'Try Again Later',
      useCurrentLocation: 'Use current location',
      simulateLocation: 'Simulate Lilongwe location (Dev)',
      gpsDeniedMsg: 'Location permission denied. Please allow location access in your browser or search your pickup.',
      gpsUnavailableMsg: 'Location unavailable. Please check your GPS signal or search your pickup.',
      gpsTimeoutMsg: 'GPS request timed out. Please try again or drag the pin on the map.',
      gpsInsecureMsg: 'Geolocation requires a secure connection (HTTPS). Please search your location manually.',
      prohibitedNotice: 'I confirm the package contains no weapons, drugs, cash, or hazardous items.',
      termsNotice: 'I agree to the Terms of Service & Privacy Policy',
      driverAgreementNotice: 'I agree to the 30% commission, debt limit, and document verification policy',
      navActivity: 'Activity',
      navAccount: 'Account'
    },
    ny: {
      appName: 'Aarohan Malawi',
      brandTagline: 'Uka • Manga • Kula', // NEEDS NATIVE REVIEW (EN: "Rise • Build • Grow")
      tagline: 'Uka • Manga • Kula • Lilongwe', // NEEDS NATIVE REVIEW (EN: "Rise • Build • Grow • Lilongwe")
      liveBadge: 'Pa Nthawi Yomweyo',
      walletHeader: 'Chikwama',
      whereTo: 'Mukupita kuti ku Lilongwe?',
      searchPlaceholder: 'Lembani Area 10, Area 18, Area 49, Lumbadzi, EPTL...',
      pickupLabel: 'Ponyamukira',
      destinationLabel: 'Kofikira',
      viaStopLabel: 'Poyimilira Podutsa',
      addStopBtn: '+ Onjezani Poyimilira',
      removeStopBtn: 'Chotsani',
      popularPlaces: 'Malo Odziwika ku Lilongwe',
      customPickup: 'Lembani msewu kapena malo onyanyukira',
      useGps: 'Gwiritsani Ntchito GPS ya Foni',
      useCurrentLocation: 'Gwiritsani ntchito komwe muli pompano', // NEEDS NATIVE REVIEW (EN: "Use current location")
      simulateLocation: 'Yesani malo a Lilongwe (Dev)', // NEEDS NATIVE REVIEW (EN: "Simulate Lilongwe location (Dev)")
      gpsDeniedMsg: 'Malo sanaloledwe. Chonde lolani malo mu msakatuli mwanu kapena fufuzani pamanja.', // NEEDS NATIVE REVIEW (EN: "Location permission denied...")
      gpsUnavailableMsg: 'Malo sakupezeka. Chonde yang\'anani chizindikiro cha GPS.', // NEEDS NATIVE REVIEW (EN: "Location unavailable...")
      gpsTimeoutMsg: 'Nthawi ya GPS yapita. Chonde yesaninso kapena lembani pamanja.', // NEEDS NATIVE REVIEW (EN: "GPS request timed out...")
      gpsInsecureMsg: 'Kupeza malo kumafuna kulumikizana kotetezeka (HTTPS).', // NEEDS NATIVE REVIEW (EN: "Geolocation requires a secure connection (HTTPS)...")
      prohibitedNotice: 'Ndikuvomereza kuti phukuloli mulibe zida, mankhwala osokoneza, ndalama kapena zinthu zoopsa.', // NEEDS NATIVE REVIEW (EN: "I confirm package contains no weapons...")
      termsNotice: 'Ndikuvomera Migwirizano Yantchito & Mfundo Zachinsinsi', // NEEDS NATIVE REVIEW (EN: "I agree to Terms of Service & Privacy Policy")
      driverAgreementNotice: 'Ndikuvomera komishoni ya 30%, malire a ngongole, ndi ndondomeko ya zikalata', // NEEDS NATIVE REVIEW (EN: "I agree to 30% commission, debt limit...")
      navActivity: 'Ntchito', // NEEDS NATIVE REVIEW (EN: "Activity")
      navAccount: 'Akaunti', // NEEDS NATIVE REVIEW (EN: "Account")
      routeSummary: 'Mtengo Wovomerezeka ndi Server',
      bookMoto: 'Yitanani Aarohan Moto',
      bookAuto: 'Yitanani Aarohan Auto',
      bookCab: 'Yitanani Aarohan Cab',
      rideNow: 'Yendani Panopa',
      scheduleLater: 'Konzani Zamtsogolo',
      scheduleModalTitle: 'Konzani Ulendo wa Mtsogolo',
      scheduleModalSub: 'Pemphani galimoto ya m\'mawa kwambiri kapena ya ku eyapoti',
      selectDate: 'Sankhani Tsiku',
      selectTime: 'Sankhani Nthawi',
      confirmSchedule: 'Tsimikizani Ulendo wa Mtsogolo',
      scheduledNotice: 'Ulendo Wokonzedwa Ulipo',
      surgeBadge: 'Kufunika Kwa Magalimoto Kwakwera',
      toggleHeatmap: 'Malo Okhala ndi Anthu Ambiri',
      safetyShield: 'Chitetezo Chokhazikika',
      audioShieldActive: 'Kujambula Mau Pachitetezo Kuli Ntchito',
      deviationAlertTitle: 'Kupatuka pa Msewu Wovomerezeka',
      deviationAlertSub: 'Galimoto yanu yapatuka pa njira yoyenera ya Kaunda Rd / M1.',
      iAmSafe: 'Ndili Bwino (Dilaiva walambalala)',
      alertPolice: 'Chenjezani Apolisi (997) ndi Aarohan',
      captainApproaching: 'Oyendetsa ali m\'njira kubwera',
      captainArrived: 'Oyendetsa Wafika!',
      showPinToCaptain: 'Onetsani Nambala ya Chitetezo (PIN) {pin} kwa {name}',
      startRidePinVerified: 'PIN Yatsimikizika • Yambani Ulendo',
      inTransitTo: 'Tili M\'njira Kupita ku {dest}',
      tripCompletedTitle: 'Mwafika Kumene Mukupita!',
      tripCompletedSub: 'Ulendo Watha • Ndalama Zamasulidwa',
      receiptEscrowSub: '70% yapita kwa Dilaiva • 30% ya Aarohan Platform',
      rateCaptain: 'Perekani Chigoli kwa Oyendetsa',
      selectTip: 'Onjezani Mphotho (100% kwa Dilaiva)',
      doneBookAnother: 'Zatha / Yitanani Ulendo Wina',
      navRide: 'Ulendo',
      navOwnly: 'Kubwereka',
      navParcel: 'Katundu',
      navTravel: 'Akunja',
      navProfile: 'Mbiri',
      rentalsTitle: 'Kubwereka Magalimoto Kudziyendetsera',
      rentalsSub: 'Bwerekkani magalimoto pa ola kapena patsiku mu Lilongwe.',
      rentBtn: 'Bwerekani Galimoto',
      parcelTitle: 'Kutumiza Katundu Mwachangu',
      parcelSub: 'Kutumiza zikalata, mabokosi ndi zakudya mu Lilongwe.',
      dispatchParcel: 'Tumizani Wonyamula Katundu',
      travelTitle: 'Maulendo Akunja kwa Lilongwe',
      travelSub: 'Magalimoto omasuka opita m\'mizinda ina ya Malawi.',
      bookIntercity: 'Sankhani Ulendo wa Kutali',
      walletTitle: 'Chikwama cha Aarohan Kwacha',
      topUpBtn: 'Onjezani Ndalama (Airtel/TNM)',
      sendKwachaBtn: 'Tumizani Kwacha',
      recentTx: 'Zomwe Mwachita Posachedwa',
      savedPlaces: 'Malo Okhazikika ku Lilongwe',
      loginTitle: 'Lowani mu Aarohan',
      loginSub: 'Mayendedwe amakono komanso otetezeka ku Lilongwe',
      phoneLabel: 'Nambala ya Foni ya ku Malawi',
      requestOtpBtn: 'Tumizani Nambala Yachinsinsi',
      otpTitle: 'Tsimikizani Foni Yanu',
      otpSub: 'Lowetsani nambala 6 yomwe yatumizidwa ku {phone}',
      otpLabel: 'Nambala 6 ya SMS',
      verifyOtpBtn: 'Tsimikizani & Pitirizani',
      changePhoneBtn: 'Sinthani Foni',
      logoutBtn: 'Tulukani',
      driverPendingTitle: 'Chikalata Chikuwunikidwa',
      driverPendingSub: 'Mbiri yanu yaudilaiva ikudikira kuvomerezedwa ndi oyang\'anira Aarohan ku Lilongwe.',
      adminLoginTitle: 'Kulowa kwa Oyang\'anira',
      adminPasswordLabel: 'Mawu Achinsinsi',
      adminLoginBtn: 'Tsimikizani & Lowani',
      smsDeliveryFailedTitle: 'Sizingatheke Kutumiza Khodi', // NEEDS NATIVE REVIEW (EN: "Unable to Send Code")
      smsDeliveryFailedMsg: 'Kutumiza uthenga walephereka. Chonde onetsetsani kuti muli ndi netiweki kapena yesaninso nthawi ina.', // NEEDS NATIVE REVIEW (EN: "SMS delivery failed...")
      tryAgainLaterBtn: 'Yesaninso Pambuyo' // NEEDS NATIVE REVIEW (EN: "Try Again Later")
    }
  };

  class AArohanI18n {
    constructor() {
      this.currentLang = localStorage.getItem(STORAGE_KEY) || 'en';
      this.listeners = [];
    }

    getLang() {
      return this.currentLang;
    }

    setLang(lang) {
      if (!translations[lang]) return;
      this.currentLang = lang;
      try {
        localStorage.setItem(STORAGE_KEY, lang);
      } catch (e) {}
      this.applyTranslations();
      this.listeners.forEach(fn => fn(lang));
    }

    toggleLang() {
      const next = this.currentLang === 'en' ? 'ny' : 'en';
      this.setLang(next);
      return next;
    }

    t(key, params = {}) {
      const dict = translations[this.currentLang] || translations.en;
      let text = dict[key] || translations.en[key] || key;
      Object.keys(params).forEach(k => {
        text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), params[k]);
      });
      return text;
    }

    onLanguageChange(callback) {
      this.listeners.push(callback);
    }

    applyTranslations() {
      document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (key) {
          el.innerText = this.t(key);
        }
      });

      document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        if (key) {
          el.setAttribute('placeholder', this.t(key));
        }
      });

      // Update Header language pill
      const langBadge = document.getElementById('lang-toggle-text');
      if (langBadge) {
        langBadge.innerText = this.currentLang === 'en' ? '🇲🇼 NY' : '🇬🇧 EN';
      }
    }
  }

  window.aarohanI18n = new AArohanI18n();

  document.addEventListener('DOMContentLoaded', () => {
    window.aarohanI18n.applyTranslations();
  });

})(window);
