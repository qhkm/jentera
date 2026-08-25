/* Ported from the old engine (KV_COUNTRIES).
   Data only — hand-edit directly; there's no generator anymore. */

import type { Country, CountryCode } from '../types';

export const COUNTRIES: Record<CountryCode, Country> = {
  "MY": {
    "code": "MY",
    "name": "Malaysia",
    "lang": "bm",
    "currency": "RM",
    "tld": ".my",
    "defaultCh": [
      "WhatsApp",
      "Instagram"
    ],
    "cities": {
      "kuala lumpur": "Kuala Lumpur, MY",
      "kl": "Kuala Lumpur, MY",
      "shah alam": "Shah Alam, MY",
      "petaling jaya": "Petaling Jaya, MY",
      "pj": "Petaling Jaya, MY",
      "subang": "Subang Jaya, MY",
      "cyberjaya": "Cyberjaya, MY",
      "putrajaya": "Putrajaya, MY",
      "penang": "George Town, Penang, MY",
      "george town": "George Town, Penang, MY",
      "johor": "Johor Bahru, MY",
      "johor bahru": "Johor Bahru, MY",
      "jb": "Johor Bahru, MY",
      "melaka": "Melaka, MY",
      "ipoh": "Ipoh, MY",
      "seremban": "Seremban, MY",
      "kota kinabalu": "Kota Kinabalu, MY",
      "kuching": "Kuching, MY",
      "singapore": "Singapore, SG"
    }
  },
  "ID": {
    "code": "ID",
    "name": "Indonesia",
    "lang": "id",
    "currency": "Rp",
    "tld": ".co.id",
    "defaultCh": [
      "WhatsApp",
      "Instagram",
      "Shopee"
    ],
    "cities": {
      "jakarta": "Jakarta, ID",
      "bandung": "Bandung, ID",
      "surabaya": "Surabaya, ID",
      "medan": "Medan, ID",
      "bali": "Denpasar, ID",
      "denpasar": "Denpasar, ID",
      "yogyakarta": "Yogyakarta, ID",
      "semarang": "Semarang, ID",
      "makassar": "Makassar, ID",
      "bekasi": "Bekasi, ID",
      "depok": "Depok, ID",
      "tangerang": "Tangerang, ID"
    }
  },
  "SG": {
    "code": "SG",
    "name": "Singapore",
    "lang": "en",
    "currency": "S$",
    "tld": ".sg",
    "defaultCh": [
      "WhatsApp",
      "Instagram"
    ],
    "cities": {
      "singapore": "Singapore, SG",
      "jurong": "Jurong, SG",
      "woodlands": "Woodlands, SG",
      "tampines": "Tampines, SG"
    }
  },
  "TH": {
    "code": "TH",
    "name": "Thailand",
    "lang": "th",
    "currency": "฿",
    "tld": ".co.th",
    "defaultCh": [
      "Line",
      "Facebook"
    ],
    "cities": {
      "bangkok": "Bangkok, TH",
      "krung thep": "Bangkok, TH",
      "chiang mai": "Chiang Mai, TH",
      "phuket": "Phuket, TH",
      "pattaya": "Pattaya, TH",
      "hat yai": "Hat Yai, TH",
      "nakhon ratchasima": "Nakhon Ratchasima, TH",
      "khon kaen": "Khon Kaen, TH"
    }
  },
  "VN": {
    "code": "VN",
    "name": "Vietnam",
    "lang": "vi",
    "currency": "₫",
    "tld": ".vn",
    "defaultCh": [
      "Zalo",
      "Facebook"
    ],
    "cities": {
      "ho chi minh": "Ho Chi Minh City, VN",
      "saigon": "Ho Chi Minh City, VN",
      "hanoi": "Hanoi, VN",
      "da nang": "Da Nang, VN",
      "can tho": "Can Tho, VN",
      "hai phong": "Hai Phong, VN",
      "nha trang": "Nha Trang, VN"
    }
  },
  "PH": {
    "code": "PH",
    "name": "Philippines",
    "lang": "fil",
    "currency": "₱",
    "tld": ".ph",
    "defaultCh": [
      "Facebook Messenger",
      "Viber",
      "WhatsApp"
    ],
    "cities": {
      "manila": "Manila, PH",
      "quezon city": "Quezon City, PH",
      "cebu": "Cebu City, PH",
      "davao": "Davao City, PH",
      "makati": "Makati, PH",
      "tagaytay": "Tagaytay, PH"
    }
  }
};
