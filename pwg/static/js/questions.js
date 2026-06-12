/* Pinoy Word Games — Level Bank (v2)
 * 100 levels following the Letter-Shift Series manual (see ../../MANUAL.md).
 * Types: NDL (dagdag letra, end), NBL (bawas letra, end),
 *        NKL (kislap letra, same positions), BS (banat salita, mid insert).
 * Answers are always "WORD1 - WORD2".
 *
 * Levels 1–10 are the TUTORIAL: each game type is introduced with a lesson
 * card (`tut`: title/text + worked example from the manual) and reinforced
 * with a practice level (`tip`: short reminder). Level 10 is the graduation.
 *
 * This file is the local fallback bank; the live bank is read from Firestore
 * (collection `pwg_levels`) and seeded from this same data.
 */

export const PWG_BANK_VERSION = 2;

export const PWG_QUESTIONS = [
  // ---- Levels 1–10 · TUTORIAL ----
  {
    level: 1, type: "1DL",
    q: "NILALANG NA NAG-IISIP na MAY 365 ARAW",
    a: "TAO - TAON",
    tut: {
      title: "Aralin 1 · Dagdag Letra (DL)",
      text: "Bawat tanong, DALAWANG salita ang sagot — magkaugnay ang mga letra nila. Sa DL, ang Salita 2 ay ang Salita 1 na DINAGDAGAN ng letra SA DULO. Ang numero sa tsapa (hal. 1DL) ang bilang ng dagdag na letra. I-type ang unang salita, pindutin ang - para tumalon sa pangalawang kahon.",
      example: {
        q: "MAGANDANG UMAGA ng ANYONG TUBIG",
        a: "BATI - BATIS",
        note: "MAGANDANG UMAGA = BATI. Dagdagan ng S sa dulo: BATI + S = BATIS, isang ANYONG TUBIG."
      }
    }
  },
  {
    level: 2, type: "1DL",
    q: "NARARAMDAMAN TUWING PISTA na GALAW SA SALIW NG TUGTUGIN",
    a: "SAYA - SAYAW",
    tip: "Tandaan: 1DL — hanapin muna ang unang salita, tapos dagdagan ng 1 letra sa dulo para makuha ang pangalawa."
  },
  {
    level: 3, type: "1DL",
    q: "MAY TUGMA AT SUKAT na TAWIRAN SA ILOG",
    a: "TULA - TULAY",
    tip: "Huling DL practice! Tingnan ang mga kahon sa ibaba — makikita mo kung saan papasok ang dagdag na letra."
  },
  {
    level: 4, type: "1BL",
    q: "GULAY NA LILA na LUKSO",
    a: "TALONG - TALON",
    tut: {
      title: "Aralin 2 · Bawas Letra (BL)",
      text: "Baligtad naman: sa BL, ang Salita 2 ay ang Salita 1 na BINAWASAN ng letra MULA SA DULO. Ang numero sa tsapa ang bilang ng tinanggal na letra.",
      example: {
        q: "SAKTO ng ANYONG TUBIG",
        a: "SAPAT - SAPA",
        note: "SAKTO = SAPAT. Tanggalin ang huling letra: SAPAT − T = SAPA, isang ANYONG TUBIG."
      }
    }
  },
  {
    level: 5, type: "1BL",
    q: "TIRAHAN na DULOT NG MALAKAS NA ULAN",
    a: "BAHAY - BAHA",
    tip: "Tandaan: 1BL — alisin ang huling letra ng unang salita para makuha ang pangalawa."
  },
  {
    level: 6, type: "1KL",
    q: "ALAGANG NGUMINGIYAW na TUMITIBOK SA DIBDIB",
    a: "PUSA - PUSO",
    tut: {
      title: "Aralin 3 · Kislap Letra (KL)",
      text: "Sa KL, PAREHONG HABA ang dalawang salita — may letra lang na PINALITAN sa PAREHONG POSISYON. Maaaring nasa unahan, gitna, o dulo ang palit; ang numero sa tsapa ang bilang ng letrang nagbago.",
      example: {
        q: "sa KAPATID ko PINAGAWA",
        a: "UTOL - UTOS",
        note: "KAPATID = UTOL. Palitan ang ika-4 na letra: UTO[L] → UTO[S] = UTOS, ang PINAGAWA."
      }
    }
  },
  {
    level: 7, type: "1KL",
    q: "LASA NG KALAMANSI na PAMPAALAT NG ULAM",
    a: "ASIM - ASIN",
    tip: "Tandaan: 1KL — parehong haba ang dalawang salita; isang letra lang ang nag-iba."
  },
  {
    level: 8, type: "BS",
    q: "HINIHIGAAN SA KUWARTO na KAAGAPAY SAAN MAN MAGPUNTA",
    a: "KAMA - KASAMA",
    tut: {
      title: "Aralin 4 · Banat Salita (BS)",
      text: "Sa BS, BINABANAT ang unang salita: hatiin ito sa unahan at dulo, tapos magsingit ng letra SA GITNA para mabuo ang pangalawang salita. Kahit ilang letra ang maaaring isingit.",
      example: {
        q: "KINAMOT na HAYOP",
        a: "KATI - KALAPATI",
        note: "KINAMOT = KATI. Hatiin: KA + TI, tapos singitan ang gitna: KA + LAPA + TI = KALAPATI, isang HAYOP."
      }
    }
  },
  {
    level: 9, type: "BS",
    q: "PANTAPAK na MAG-ANAK",
    a: "PAA - PAMILYA",
    tip: "Tandaan: BS — buksan ang unang salita sa gitna at magsingit ng letra. Pareho pa rin ang unahan at dulo."
  },
  {
    level: 10, type: "1DL",
    q: "GAWAIN SA MARURUMING DAMIT na BAKBAKAN",
    a: "LABA - LABAN",
    tut: {
      title: "Huling Aralin · Pagtatapos! 🎓",
      text: "Alam mo na ang apat na uri: DL (dagdag sa dulo), BL (bawas sa dulo), KL (palit sa parehong posisyon), at BS (singit sa gitna). Basahin lagi ang tsapa para malaman ang uri at bilang ng letra. Mula sa susunod na level, wala nang gabay — pero nandiyan lagi ang 💡 Pahiwatig kung kailangan mo. Sagutan ito para mag-graduate!",
      grad: true
    }
  },

  // ---- Levels 11–18 · 1DL (dagdag 1 letra sa dulo) ----
  { level: 11, type: "1DL", q: "KULAY NG ULAP na NASA KANAL PAGKATAPOS NG ULAN", a: "PUTI - PUTIK" },
  { level: 12, type: "1DL", q: "HAYOP NA PINAGKUKUNAN NG GATAS na MATIGAS NA METAL", a: "BAKA - BAKAL" },
  { level: 13, type: "1DL", q: "MUSMOS na IPINATUTUPAD NG PAMAHALAAN", a: "BATA - BATAS" },
  { level: 14, type: "1DL", q: "MURANG NIYOG NA PANTANGGAL-UHAW na HIWALAY SA IBA", a: "BUKO - BUKOD" },
  { level: 15, type: "1DL", q: "PINAKAMALIIT NA HALAGA NG BARYA na PAMPATAG NG BAGONG SEMENTONG KALSADA", a: "PISO - PISON" },
  { level: 16, type: "1DL", q: "MAANGAS SA KANTO na MALAKAS NA BOSES", a: "SIGA - SIGAW" },
  { level: 17, type: "1DL", q: "GAWAIN SA PALENGKE na HUMANGA NANG TODO", a: "BILI - BILIB" },
  { level: 18, type: "1DL", q: "DAMIT NA NAULANAN na PINGGANG NAHULOG", a: "BASA - BASAG" },

  // ---- Levels 19–28 · 1BL (bawas 1 letra sa dulo) ----
  { level: 19, type: "1BL", q: "INUMING MULA SA BAKA na PIGA MULA SA NIYOG", a: "GATAS - GATA" },
  { level: 20, type: "1BL", q: "PANGUNAHING SANGKAP NG OKOY na DAMPI NG KAMAY", a: "HIPON - HIPO" },
  { level: 21, type: "1BL", q: "KULAY NG HINOG NA MANGGA na PANLASA SA BIBIG", a: "DILAW - DILA" },
  { level: 22, type: "1BL", q: "NAGLILIYAB SA KALAN na ANAK NG IYONG ANAK", a: "APOY - APO" },
  { level: 23, type: "1BL", q: "KUMAKALAM KAPAG GUTOM na KAPATID NI NANAY", a: "TIYAN - TIYA" },
  { level: 24, type: "1BL", q: "KABALIGTARAN NG HARAPAN na HINDI DIRETSONG DAAN", a: "LIKOD - LIKO" },
  { level: 25, type: "1BL", q: "LUMALABAS SA TAMBUTSO na SIKAT SA KASALUKUYAN", a: "USOK - USO" },
  { level: 26, type: "1BL", q: "PANLABAS NA TAKIP NG PRUTAS na LAMAN NG BARIL", a: "BALAT - BALA" },
  { level: 27, type: "1BL", q: "TUMUTULO HABANG MAHIMBING ANG TULOG na MALAWAK NA TUBIG-TABANG", a: "LAWAY - LAWA" },
  { level: 28, type: "1BL", q: "KASAMA NG KIDLAT KAPAG BUMABAGYO na GINAGAWA NG TUBIG SA TAKURE", a: "KULOG - KULO" },

  // ---- Levels 29–38 · 1KL (kislap 1 letra, parehong posisyon) ----
  { level: 29, type: "1KL", q: "KASAMA NG KANIN na NASA HIMPAPAWID", a: "ULAM - ULAP" },
  { level: 30, type: "1KL", q: "KAPANGYARIHAN NG KATAWAN na HAKBANG NANG HAKBANG", a: "LAKAS - LAKAD" },
  { level: 31, type: "1KL", q: "PAMPALUSOG NA PANANIM na BIGLANG PAGKAGITLA", a: "GULAY - GULAT" },
  { level: 32, type: "1KL", q: "LAGAKAN NG PERA na SASAKYAN SA DAGAT", a: "BANGKO - BANGKA" },
  { level: 33, type: "1KL", q: "TAHANAN NG MGA ANGHEL na PAMPADULAS SA KAWALI", a: "LANGIT - LANGIS" },
  { level: 34, type: "1KL", q: "PATUNGAN NG PAGKAIN na GANAP SA SIMBAHAN TUWING LINGGO", a: "MESA - MISA" },
  { level: 35, type: "1KL", q: "DAANAN PAPASOK NG BAHAY na ISKOR SA LARO", a: "PINTO - PUNTO" },
  { level: 36, type: "1KL", q: "ANI NG PUNO na SISIDLANG LUWAD NG TUBIG", a: "BUNGA - BANGA" },
  { level: 37, type: "1KL", q: "BINABASA SA AKLATAN na PANUKAT NG TUBIG O GASOLINA", a: "LIBRO - LITRO" },
  { level: 38, type: "1KL", q: "PAHINGA SA GABI na ISINISIGAW KAPAG MAY KUMATOK", a: "TULOG - TULOY" },

  // ---- Levels 39–44 · BS (banat salita, madali) ----
  { level: 39, type: "BS", q: "TAKBUHAN SA KUSINA KAPAG NAMATAAN na BABAENG NASA HUSTONG GULANG", a: "DAGA - DALAGA" },
  { level: 40, type: "BS", q: "TANONG KUNG NASA ALING LUGAR na PAMPASULONG NG BANGKA", a: "SAAN - SAGWAN" },
  { level: 41, type: "BS", q: "MALIIT NA IBONG KAYUMANGGI na BATI TUWING KAARAWAN", a: "MAYA - MALIGAYA" },
  { level: 42, type: "BS", q: "PANG-AKIT SA ISDA na NASA HAPAG TUWING TANGHALIAN", a: "PAIN - PAGKAIN" },
  { level: 43, type: "BS", q: "BAHAY NA MUNTI SA AWITIN na PANANGGALANG SA LAMOK", a: "KUBO - KULAMBO" },
  { level: 44, type: "BS", q: "NILALAKARAN na HIMPILAN NG MGA BARKO", a: "DAAN - DAUNGAN" },

  // ---- Levels 45–60 · singles, mas pasikot-sikot na salita ----
  { level: 45, type: "1DL", q: "PANSAWSAW NA MAASIM na HABA AT LAPAD", a: "SUKA - SUKAT" },
  { level: 46, type: "1DL", q: "PAGKAMANGHA na LAGING GUTOM ANG MATA AT TIYAN", a: "TAKA - TAKAW" },
  { level: 47, type: "1DL", q: "MATIGAS NA TAKIP NG NIYOG na DALA-DALANG PERA O PAGKAIN SA ESKUWELA", a: "BAO - BAON" },
  { level: 48, type: "1DL", q: "KALAGAYANG WALANG GAPOS na HINIHILA NG HANGIN SA BANGKA", a: "LAYA - LAYAG" },
  { level: 49, type: "1BL", q: "TUMITILAOK SA UMAGA na PAGGALANG SA NAKATATANDA", a: "MANOK - MANO" },
  { level: 50, type: "1BL", q: "MAALAT NA PANSAWSAW MULA SA ISDA na IBIG SABIHIN AY KASAMA RIN", a: "PATIS - PATI" },
  { level: 51, type: "1BL", q: "GINAGAMIT SA PAGSASALITA na SISIW NG PATO", a: "BIBIG - BIBI" },
  { level: 52, type: "1BL", q: "MALALIM NA KUHANAN NG TUBIG na NAIWAN NG YUMAONG ASAWA", a: "BALON - BALO" },
  { level: 53, type: "1KL", q: "ISINASAING na NARARAMDAMAN SA TIMBANG", a: "BIGAS - BIGAT" },
  { level: 54, type: "1KL", q: "PANAHON NG TAG-ARAW na UNAT NG KATAWAN PAGKAGISING", a: "INIT - INAT" },
  { level: 55, type: "1KL", q: "PAGTAPON NG TUBIG MULA SA TIMBA na MAHIRAP KALAGIN SA TALI", a: "BUHOS - BUHOL" },
  { level: 56, type: "1KL", q: "GINAGAWA NG IBON SA HIMPAPAWID na LUMA NA SA PANAHON", a: "LIPAD - LIPAS" },
  { level: 57, type: "1KL", q: "PINAKAMASARAP SA BULALO na MAGKAAGAPAY NA KILOS", a: "SABAW - SABAY" },
  { level: 58, type: "1KL", q: "PAMBILI NG BIGAS na ISINISIGAW PARA PAHINTUIN ANG DYIP", a: "PERA - PARA" },
  { level: 59, type: "1KL", q: "REAKSIYON SA NAKAKATUWA na DAGDAG SA TIMBANG", a: "TAWA - TABA" },
  { level: 60, type: "1KL", q: "GAWA SA KUSINA na HINDI ALAM ANG PIPILIIN", a: "LUTO - LITO" },

  // ---- Levels 61–68 · 2DL ----
  { level: 61, type: "2DL", q: "NALILIKHA NG SABON SA TUBIG na MAHABANG UOD SA LUPA", a: "BULA - BULATE" },
  { level: 62, type: "2DL", q: "HINDI KATULAD na KABILANG PAMPANG", a: "IBA - IBAYO" },
  { level: 63, type: "2DL", q: "PANGGAPOS O PAMBIGKIS na YAMAN NG ISIP", a: "TALI - TALINO" },
  { level: 64, type: "2DL", q: "TINATAMNAN na MALAWAK NA TERITORYO", a: "LUPA - LUPAIN" },
  { level: 65, type: "2DL", q: "PINUNO NG KAHARIAN na PANGUNAHING SANGKAP NG TINAPAY", a: "HARI - HARINA" },
  { level: 66, type: "2DL", q: "GINAGAMIT SA PAGTINGIN na ABOT-LANGIT", a: "MATA - MATAAS" },
  { level: 67, type: "2DL", q: "NILAGANG BUTIL SA SUPOT na LARUANG BINIBIHISAN", a: "MANI - MANIKA" },
  { level: 68, type: "2DL", q: "NAGBIBIGAY-LIWANAG na GASERANG SISIDLAN NITO", a: "ILAW - ILAWAN" },

  // ---- Levels 69–78 · 2BL ----
  { level: 69, type: "2BL", q: "SUOT SA PAA PAPASOK SA OPISINA na HUSTONG-HUSTO", a: "SAPATOS - SAPAT" },
  { level: 70, type: "2BL", q: "DUNGAWAN NG BAHAY na MAKULAY NA BANGKA SA MINDANAO", a: "BINTANA - BINTA" },
  { level: 71, type: "2BL", q: "SINASAKYAN NG KOBOY na RAMDAM NG DIBDIB BAGO ANG EKSAMEN", a: "KABAYO - KABA" },
  { level: 72, type: "2BL", q: "SILID-IMBAKAN NG KARUNUNGAN na ISA SA MGA LAMAN NITO", a: "AKLATAN - AKLAT" },
  { level: 73, type: "2BL", q: "KABIBING BERDE ANG GILID na SIGAW NG MAGLALAKO SA UMAGA", a: "TAHONG - TAHO" },
  { level: 74, type: "2BL", q: "SAMPU SA DALAWANG KAMAY na MABILIS LANG", a: "DALIRI - DALI" },
  { level: 75, type: "2BL", q: "PINAPATUNGAN NG PASANIN na MULING PAGDATING", a: "BALIKAT - BALIK" },
  { level: 76, type: "2BL", q: "KABIYAK SA BUHAY na PAGTITIWALANG MANGYAYARI PA", a: "ASAWA - ASA" },
  { level: 77, type: "2BL", q: "KASUNOD MO SA SIKAT NG ARAW na BUNGA NG PAGSASAKA", a: "ANINO - ANI" },
  { level: 78, type: "2BL", q: "PANG-ILAW NOONG UNANG PANAHON na MADALAS MATUMBA", a: "LAMPARA - LAMPA" },

  // ---- Levels 79–86 · 2KL ----
  { level: 79, type: "2KL", q: "LIHAM SA KAIBIGAN na MATAMIS MULA SA PUKYUTAN", a: "SULAT - PULOT" },
  { level: 80, type: "2KL", q: "RAMDAM SA BAHAY NA MULTO na PANSARA NG GARAPON", a: "TAKOT - TAKIP" },
  { level: 81, type: "2KL", q: "ITINUSOK SA LUPA UPANG TUMUBO na NAKIKITA MULA SA MALAYO", a: "TANIM - TANAW" },
  { level: 82, type: "2KL", q: "HUGIS NG KABILUGAN NG BUWAN na ITLOG NA MERYENDA PAGSAPIT NG DILIM", a: "BILOG - BALOT" },
  { level: 83, type: "2KL", q: "PAGLULUTO NG KANIN na NILALAMPASO", a: "SAING - SAHIG" },
  { level: 84, type: "2KL", q: "LASA NG PULOT na ABOT SA PINAGSIKAPAN", a: "TAMIS - KAMIT" },
  { level: 85, type: "2KL", q: "ORAS PAGKATAPOS NG TANGHALI na HABI NG GAGAMBA", a: "HAPON - SAPOT" },
  { level: 86, type: "2KL", q: "NASA PAGITAN NG TUHOD AT PAA na PAMPAKULAY SA DINGDING", a: "BINTI - PINTA" },

  // ---- Levels 87–92 · BS (banat salita, mahirap) ----
  { level: 87, type: "BS", q: "NAIPAPASA NG MAY SAKIT na MODELONG MAAARING TULARAN", a: "HAWA - HALIMBAWA" },
  { level: 88, type: "BS", q: "SUGAT MULA SA MAINIT na HARDING WALANG-HANGGANG LIGAYA", a: "PASO - PARAISO" },
  { level: 89, type: "BS", q: "NAKATALAGA PARA SA IYO na LIBANGAN NG MGA BATA", a: "LAAN - LARUAN" },
  { level: 90, type: "BS", q: "PARUSA NG TSINELAS NI NANAY na PATIMPALAK TUWING PISTA", a: "PALO - PALARO" },
  { level: 91, type: "BS", q: "GRUPO NG MGA TUPA na MATIBAY NA PUNONG YUMUYUKO SA HANGIN", a: "KAWAN - KAWAYAN" },
  { level: 92, type: "BS", q: "PAGLINGON NG ULO na PRUTAS NA MAY LIMANG GILID", a: "BALING - BALIMBING" },

  // ---- Levels 93–100 · finale: 3+ letra ----
  { level: 93, type: "3DL", q: "TAMBAYAN NG BISITA SA BAHAY na DITO MO NAKIKITA ANG SARILI", a: "SALA - SALAMIN" },
  { level: 94, type: "3DL", q: "BALANGKAS NG KATAWAN na PANSARA NG POLO", a: "BUTO - BUTONES" },
  { level: 95, type: "3BL", q: "PUWESTO NI ALING NENA SA KANTO na MGA PANINDA NITO", a: "TINDAHAN - TINDA" },
  { level: 96, type: "3BL", q: "DAMBUHALANG NILALANG SA ALAMAT na POSISYON SA KAMA", a: "HIGANTE - HIGA" },
  { level: 97, type: "3KL", q: "KUWARTONG TULUGAN na DAKONG PINAGTATAGPUAN NG DALAWANG PADER", a: "SILID - SULOK" },
  { level: 98, type: "4KL", q: "MASUKAL NA TAHANAN NG MABABANGIS na TANIMAN NG PALAY", a: "GUBAT - BUKID" },
  { level: 99, type: "4BL", q: "MAKULAY NA ARKO PAGKATAPOS NG ULAN na SINAUNANG KASUOTAN", a: "BAHAGHARI - BAHAG" },
  { level: 100, type: "5DL", q: "PAGTUKOY NG NAIS na PERLAS NG SILANGANAN", a: "PILI - PILIPINAS" }
];

/* Human-readable label per type code, e.g. "2DL" -> "2 Dagdag Letra". */
export function typeLabel(type) {
  const m = /^(\d*)(DL|BL|KL|BS)$/.exec(type) || [];
  const n = m[1] || "";
  const names = {
    DL: "Dagdag Letra",
    BL: "Bawas Letra",
    KL: "Kislap Letra",
    BS: "Banat Salita"
  };
  const base = names[m[2]] || type;
  return n ? n + " " + base : base;
}
