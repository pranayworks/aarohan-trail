// AArohan Urban Mobility • Internationalization & Localization Engine
// Bilingual English (EN) & Chichewa (NY) for Lilongwe, Malawi

(function(window) {
  'use strict';

  const STORAGE_KEY = 'aarohan_language';

  const translations = {
    en: {
      appName: 'AArohan Malawi',
      tagline: 'Smart Urban Mobility • Lilongwe',
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
      bookMoto: 'Book AArohan Moto',
      bookAuto: 'Book AArohan Auto',
      bookCab: 'Book AArohan Cab',
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
      receiptEscrowSub: '70% settled to Captain • 30% AArohan Platform',
      rateCaptain: 'Rate Your Captain',
      selectTip: 'Add Driver Gratuity (100% to Captain)',
      doneBookAnother: 'Done / Book Another Ride',
      navRide: 'Ride',
      navOwnly: 'Ownly',
      navParcel: 'Parcel',
      navTravel: 'Travel',
      navProfile: 'Profile',
      rentalsTitle: 'AArohan Ownly Self-Drive',
      rentalsSub: 'Hourly and daily vehicle rentals across Lilongwe.',
      rentBtn: 'Rent Vehicle',
      parcelTitle: 'AArohan Parcel Delivery',
      parcelSub: 'Fast courier for documents, packages & food across Lilongwe.',
      dispatchParcel: 'Dispatch Parcel Courier',
      travelTitle: 'AArohan Intercity Travel',
      travelSub: 'Comfortable outstation cabs & shuttles across Malawi.',
      bookIntercity: 'Book Intercity Journey',
      walletTitle: 'AArohan Kwacha Wallet',
      topUpBtn: 'Top Up (Airtel/TNM)',
      sendKwachaBtn: 'Send Kwacha',
      recentTx: 'Recent Transactions',
      savedPlaces: 'Saved Places in Lilongwe',
      loginTitle: 'Sign In to AArohan',
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
      driverPendingSub: 'Your driver partner profile is pending verification by AArohan operations in Lilongwe.',
      adminLoginTitle: 'Operations Desk Access',
      adminPasswordLabel: 'Admin Password',
      adminLoginBtn: 'Verify & Sign In'
    },
    ny: {
      appName: 'AArohan Malawi',
      tagline: 'Kuyenda Mwanzeru Mtawuni • Lilongwe',
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
      routeSummary: 'Mtengo Wovomerezeka ndi Server',
      bookMoto: 'Yitanani AArohan Moto',
      bookAuto: 'Yitanani AArohan Auto',
      bookCab: 'Yitanani AArohan Cab',
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
      alertPolice: 'Chenjezani Apolisi (997) ndi AArohan',
      captainApproaching: 'Oyendetsa ali m\'njira kubwera',
      captainArrived: 'Oyendetsa Wafika!',
      showPinToCaptain: 'Onetsani Nambala ya Chitetezo (PIN) {pin} kwa {name}',
      startRidePinVerified: 'PIN Yatsimikizika • Yambani Ulendo',
      inTransitTo: 'Tili M\'njira Kupita ku {dest}',
      tripCompletedTitle: 'Mwafika Kumene Mukupita!',
      tripCompletedSub: 'Ulendo Watha • Ndalama Zamasulidwa',
      receiptEscrowSub: '70% yapita kwa Dilaiva • 30% ya AArohan Platform',
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
      walletTitle: 'Chikwama cha AArohan Kwacha',
      topUpBtn: 'Onjezani Ndalama (Airtel/TNM)',
      sendKwachaBtn: 'Tumizani Kwacha',
      recentTx: 'Zomwe Mwachita Posachedwa',
      savedPlaces: 'Malo Okhazikika ku Lilongwe',
      loginTitle: 'Lowani mu AArohan',
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
      driverPendingSub: 'Mbiri yanu yaudilaiva ikudikira kuvomerezedwa ndi oyang\'anira AArohan ku Lilongwe.',
      adminLoginTitle: 'Kulowa kwa Oyang\'anira',
      adminPasswordLabel: 'Mawu Achinsinsi',
      adminLoginBtn: 'Tsimikizani & Lowani'
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
