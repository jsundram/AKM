// window.Concerts — shared concert-program data for the schedule (concert cards + program links)
// and concerts.html (the full listing), plus the one printed-name → roster matcher both use.
// Hand-transcribed from the PDFs in programs/ (titles in English; a -draft pdf keeps the red DRAFT
// tag until the final lands — then repoint `pdf` and bump sw.js V). Each performer is
// [name-as-printed, instrument] — names reconcile to the roster at runtime via matcher() (no phone
// numbers here, per the PII rule). Instruments: vn va vc bass pf cl ob + voices.
// `t` is the full program title (movement in `m`), shown on concerts.html; the SHORT rehearsal-style
// title the schedule's brass card shows lives in the SHORTS registry below (resolved onto each piece
// as `p.s` at load), NOT inline — see the SHORTS comment for why.
(() => {
const g = typeof window !== "undefined" ? window : globalThis;   // Node-requirable for the test harness
const C = [
 {id:"2026-07-04-aft", title:"Afternoon Concert", time:"4:30 pm",
  venue:"Kultursaal", poi:"Kultursaal", pdf:"programs/2026-07-04-afternoon.pdf", pieces:[
  {c:"Fauré", t:"Piano Quartet No. 1 in C minor, Op. 15", m:"I. Allegro molto moderato",
   who:[["Claudia Ajmone-Marsan","vn"],["Jason Sundram","va"],["Max Buck","vc"],["Mark Zang","pf"]]},
  {c:"Schumann", t:"Piano Trio No. 2 in F major, Op. 80", m:"I. Sehr lebhaft",
   who:[["Nathan Meltzer","vn"],["Richard Beales","vc"],["Felicia Weiss","pf"]]},
  {c:"Larsen", t:"Four on the Floor", m:"",
   who:[["Melody Steinbart","vn"],["Seah Yu","vc"],["Bruce Rosenblum","bass"],["Mark Zang","pf"]]},
  {c:"Brahms", t:"String Quintet No. 2 in G major, Op. 111", m:"I. Allegro non troppo, ma con brio",
   who:[["Ingrid Burger","vn"],["Elinor Turner","vn"],["Emi Ohi Resnick","va"],["Michael Lee","va"],["Stephanie Wingfield","vc"]]},
  {brk:1},
  {c:"Shostakovich", t:"String Quartet No. 9, Op. 117", m:"V. Allegro",
   who:[["Ingrid Burger","vn"],["Maya Weil","vn"],["Angelina Freeman","va"],["David Goldesgeyme","vc"]]},
  {c:"Casarrubios", t:"luzAzul", m:"",
   who:[["Claire Maugham","vn"],["Aaron Kinghorn","vc"],["Kian Woo","pf"]]},
  {c:"Brahms", t:"String Sextet No. 1 in B-flat major, Op. 18", m:"I. Allegro ma non troppo",
   who:[["Korn Roongruangchai","vn"],["YooJin Jang","vn"],["Xinyuan Wang","va"],["Angelina Freeman","va"],["Richard Beales","vc"],["Aaron Kinghorn","vc"]]},
 ]},
 {id:"2026-07-04-eve", title:"Evening Concert", time:"8:00 pm",
  venue:"Pfarrkirche St. Nikolaus", poi:"Pfarrkirche Hl. Nikolaus", pdf:"programs/2026-07-04-evening.pdf", pieces:[
  {c:"Shostakovich", t:"String Quartet No. 8 in C minor, Op. 110", m:"I. Largo · II. Allegro molto",
   who:[["Jane Givens","vn"],["Aafke Koffeman","vn"],["Gijs Kramers","va"],["Richard Beales","vc"]]},
  {c:"Grieg", t:"String Quartet in G minor, Op. 27", m:"II. Romance: Andantino – Allegro agitato",
   who:[["Elinor Turner","vn"],["Chia-Hsuan Lin","vn"],["Joseph Steinbart","va"],["Max Buck","vc"]]},
  {c:"Bacewicz", t:"Quartet for Four Violins", m:"I. Allegretto · II. Andante tranquillo",
   who:[["Elinor Turner","vn"],["Ingrid Burger","vn"],["Tanya Jenkin","vn"],["Claudia Ajmone-Marsan","vn"]]},
  {c:"Vokalensemble Singmazomm", t:"Alpine songs — O sei gegrüßt Maria · Maria hell leuchtender Stern · Zwischen Himmel und Erde · Trag mi Wind · Abendstimmung", m:"",
   who:[["Maria Wendlinger","soprano"],["Gabi Engeler","alto"],["Alois Wendlinger","tenor"],["Lukas Kollnig","bass"]]},
  {brk:1},
  {c:"Haydn", t:"String Quartet in G major, Op. 76 No. 1", m:"II. Adagio sostenuto · III. Menuetto. Presto",
   who:[["Jisoo Kim","vn"],["Claire Maugham","vn"],["Xinyuan Wang","va"],["Preetcharn Saund","vc"]]},
  {c:"Mozart · Mendelssohn", t:"Ave verum corpus · Wirf dein Anliegen auf den Herrn — with Vokalensemble Singmazomm", m:"",
   who:[["Korn Roongruangchai","vn"],["Chia-Hsuan Lin","vn"],["Adam Clarke","va"],["David Goldesgeyme","vc"]]},
  {c:"Debussy", t:"String Quartet in G minor, Op. 10", m:"I. Animé et très décidé",
   who:[["Jane Givens","vn"],["Claudia Ajmone-Marsan","vn"],["Angelina Freeman","va"],["Seah Yu","vc"]]},
 ]},
 {id:"2026-07-08-eve", title:"Faculty Concert", time:"8:00 pm",
  venue:"Kultursaal", poi:"Kultursaal", pdf:"programs/2026-07-08-evening.pdf", pieces:[
  {c:"Mendelssohn", t:"String Quintet No. 2 in B-flat major, Op. 87", m:"I. Allegro vivace · II. Andante scherzando · III. Adagio e lento · IV. Allegro molto vivace",
   who:[["YooJin Jang","vn"],["Emi Ohi Resnick","vn"],["Ilinca Forna","va"],["Gijs Kramers","va"],["Jesús Morales","vc"]]},
  {c:"Austrian folk song, arr. Stephen Buck", t:"In die Berg bin i gern", m:"",
   who:[["Nikolaus Lanner sen.","flugelhorn"],["Robert Lexer","flugelhorn"],["Roman Cecco","flugelhorn"],["Nathan Meltzer","vn"],["Ilinca Forna","vn"],["Gijs Kramers","va"],["Jesús Morales","vc"]]},
  {c:"Kühr", t:"Portraits", m:"",
   who:[["Jesús Morales","vc"],["Stephen Buck","pf"]]},
  {c:"arr. Gijs Kramers", t:"Songs: Sammy · Ozean · Sternenstaub · Sie glaubt an mich · Schwarz-Weiß", m:"Ramses Shaffy · Racoon · André Hazes · De Jeugd van Tegenwoordig · Frank Boeijen",
   who:[["Ilinca Forna","vn"],["Gijs Kramers","va"],["Jesús Morales","vc"],["Stephen Buck","pf"]]},
  {c:"Messiaen", t:"Quartet for the End of Time", m:"Complete — eight movements · ~50 min",
   who:[["Chad Burrow","cl"],["Nathan Meltzer","vn"],["Yoanna Prodanova","vc"],["James Cheung","pf"]]},
 ]},
 {id:"2026-07-09-eve", title:"Evening Concert", time:"8:00 pm",
  venue:"Kultursaal", poi:"Kultursaal", pdf:"programs/2026-07-09-evening-draft.pdf", pieces:[
  {c:"Mozart", t:"Clarinet Quintet in A major, K. 581", m:"I. Allegro",
   who:[["Robert Dembo","cl"],["Aafke Koffeman","vn"],["Tanya Jenkin","vn"],["Isadora Banyai","va"],["Jesús Morales","vc"]]},
  {c:"Coleridge-Taylor", t:"Clarinet Quintet in F-sharp minor, Op. 10", m:"IV. Finale. Allegro agitato",
   who:[["Will Belden","cl"],["Cara Wunder","vn"],["Bernhard Zojer","vn"],["Xinyuan Wang","va"],["Jesús Morales","vc"]]},
  {c:"Jacob", t:"Oboe Quartet", m:"I. Allegro moderato",
   who:[["Chia-Hsuan Lin","vn"],["Michael Lee","va"],["Sara Phelps","vc"],["Katrina Cooper-Strich","ob"]]},
  {c:"Korngold", t:"Suite for Two Violins, Cello and Piano (left hand), Op. 23", m:"I. Prelude and Fugue · IV. Lied",
   who:[["Melody Steinbart","vn"],["Jane Givens","vn"],["Yoanna Prodanova","vc"],["Felicia Weiss","pf"]]},
  {c:"Elgar", t:"Piano Quintet in A minor, Op. 84", m:"I. Moderato – Allegro",
   who:[["Claire Maugham","vn"],["Chia-Hsuan Lin","vn"],["Gijs Kramers","va"],["Stephanie Wingfield","vc"],["Kian Woo","pf"]]},
  {brk:1},
  {c:"Ravel", t:"Piano Trio in A minor, M. 67", m:"I. Modéré",
   who:[["Matthew Chan","vn"],["Alison Atkinson","vc"],["James Cheung","pf"]]},
  {c:"Beethoven", t:"Piano Trio No. 6 in E-flat major, Op. 70 No. 2", m:"I. Poco sostenuto – Allegro ma non troppo",
   who:[["Stephen Lustig","vn"],["Jesús Morales","vc"],["Anne Schoemaker","pf"]]},
  {c:"Brahms", t:"String Quartet No. 3 in B-flat major, Op. 67", m:"I. Vivace",
   who:[["Nathan Meltzer","vn"],["Stephen Lustig","vn"],["Joseph Steinbart","va"],["Seah Yu","vc"]]},
  {c:"Bruch", t:"String Octet in B-flat major, Op. posth.", m:"I. Allegro moderato",
   who:[["Nathan Meltzer","vn"],["Aafke Koffeman","vn"],["Bernhard Zojer","vn"],["Tanya Jenkin","vn"],["Gijs Kramers","va"],["Jason Sundram","va"],["Aaron Kinghorn","vc"],["Bruce Rosenblum","bass"]]},
 ]},
 {id:"2026-07-10-eve", title:"Evening Concert", time:"8:00 pm",
  venue:"Kultursaal", poi:"Kultursaal", pdf:"programs/2026-07-10-evening.pdf", pieces:[
  {c:"Hindemith", t:"Clarinet Quartet", m:"I. Mäßig bewegt",
   who:[["Sharayu Gugnani","vn"],["Preetcharn Saund","vc"],["Daniel Compton","pf"],["Chad Burrow","cl"]]},
  {c:"Schumann", t:"Piano Quartet in E-flat major, Op. 47", m:"I. Sostenuto assai – Allegro ma non troppo",
   who:[["Korn Roongruangchai","vn"],["Joseph Steinbart","va"],["Stephanie Wingfield","vc"],["Anne Schoemaker","pf"]]},
  {c:"Arensky", t:"String Quartet No. 2 in A minor", m:"I. Moderato",
   who:[["Maya Weil","vn"],["Emi Ohi Resnick","vn"],["Valerie Ross","vc"],["Sara Phelps","vc"]]},
  {c:"Ravel", t:"String Quartet in F major, M. 35", m:"I. Allegro moderato – très doux",
   who:[["YooJin Jang","vn"],["Jisoo Kim","vn"],["Ilinca Forna","va"],["David Goldesgeyme","vc"]]},
  {c:"Brahms", t:"Piano Quartet No. 1 in G minor, Op. 25", m:"I. Allegro",
   who:[["Jane Givens","vn"],["Jason Sundram","va"],["Preetcharn Saund","vc"],["Mark Zang","pf"]]},
  {brk:1},
  {c:"Stravinsky", t:"The Soldier's Tale (Histoire du soldat)", m:"Marche du Soldat · Le violon du Soldat · Petit Concert · Danse du Diable",
   who:[["Chad Burrow","cl"],["Adriana Stamile","vn"],["Mark Zang","pf"]]},
  {c:"Brahms", t:"Clarinet Quintet in B minor, Op. 115", m:"I. Allegro",
   who:[["Chad Burrow","cl"],["Cara Wunder","vn"],["Adriana Stamile","vn"],["Ilinca Forna","va"],["Max Buck","vc"]]},
  {c:"Schubert", t:"Piano Quintet in A major, D. 667 (Trout)", m:"III. Scherzo: Presto",
   who:[["Melody Steinbart","vn"],["Ilinca Forna","va"],["Seah Yu","vc"],["Bruce Rosenblum","bass"],["Mark Zang","pf"]]},
  {c:"Beethoven", t:"String Trio in C minor, Op. 9 No. 3", m:"II. Adagio con espressione · III. Scherzo. Allegro molto e vivace",
   who:[["Bernhard Zojer","vn"],["Ilinca Forna","va"],["Valerie Ross","vc"]]},
 ]},
 {id:"2026-07-11-morn", title:"Morning Concert", time:"11:00 am",
  venue:"Kultursaal", poi:"Kultursaal", pdf:"programs/2026-07-11-morning.pdf", pieces:[
  {c:"Prokofiev", t:"Quintet in G minor, Op. 39", m:"I. Tema con variazioni · VI. Andantino",
   who:[["Korn Roongruangchai","vn"],["Emi Ohi Resnick","va"],["Will Belden","cl"],["Katrina Cooper-Strich","ob"],["Bruce Rosenblum","bass"]]},
  {c:"Haydn", t:"String Quartet in F minor, Op. 20 No. 5", m:"I. Allegro moderato",
   who:[["YooJin Jang","vn"],["Maya Weil","vn"],["Joseph Steinbart","va"],["Sara Phelps","vc"]]},
  {c:"Brahms", t:"Clarinet Trio in A minor, Op. 114", m:"I. Allegro",
   who:[["Robert Dembo","cl"],["David Goldesgeyme","vc"],["James Cheung","pf"]]},
  {c:"Beach", t:"Piano Quintet in F-sharp minor, Op. 67", m:"II. Adagio espressivo",
   who:[["Matthew Chan","vn"],["Maya Weil","vn"],["Adam Clarke","va"],["Yoanna Prodanova","vc"],["Tanya Bannister","pf"]]},
  {c:"Reinecke", t:"Trio in A major, Op. 264", m:"I. Moderato",
   who:[["Will Belden","cl"],["Michael Lee","va"],["Daniel Compton","pf"]]},
  {brk:1},
  {c:"Shostakovich", t:"Five Pieces for Two Violins and Piano", m:"Prelude · Gavotte · Elegy · Waltz · Polka",
   who:[["Tanya Jenkin","vn"],["Nathan Meltzer","vn"],["Stephen Buck","pf"]]},
  {c:"Mendelssohn", t:"String Quintet No. 2 in B-flat major, Op. 87", m:"I. Allegro vivace",
   who:[["Claire Maugham","vn"],["Chia-Hsuan Lin","vn"],["Emi Ohi Resnick","va"],["Michael Lee","va"],["Stephanie Wingfield","vc"]]},
  {c:"Dvořák", t:"Piano Quintet No. 2 in A major, Op. 81", m:"II. Dumka: Andante con moto",
   who:[["Korn Roongruangchai","vn"],["Melody Steinbart","vn"],["Adam Clarke","va"],["Alison Atkinson","vc"],["James Cheung","pf"]]},
  {c:"Loeffler", t:"Two Rhapsodies for Oboe, Viola and Piano", m:"II. La cornemuse",
   who:[["Katrina Cooper-Strich","ob"],["Isadora Banyai","va"],["Kian Woo","pf"]]},
 ]},
 {id:"2026-07-11-eve", title:"Evening Concert", time:"8:00 pm",
  venue:"Kultursaal", poi:"Kultursaal", pdf:"programs/2026-07-11-evening.pdf", pieces:[
  {c:"Dvořák", t:"String Quartet No. 14 in A-flat major, Op. 105", m:"I. Adagio ma non troppo — Allegro appassionato",
   who:[["Stephen Lustig","vn"],["Sharayu Gugnani","vn"],["Jason Sundram","va"],["Stephanie Wingfield","vc"]]},
  {c:"Schubert", t:"String Quintet in C major, D. 956", m:"I. Allegro ma non troppo",
   who:[["Jisoo Kim","vn"],["Adriana Stamile","vn"],["Adam Clarke","va"],["Preetcharn Saund","vc"],["Yoanna Prodanova","vc"]]},
  {c:"Beethoven", t:"Piano Trio No. 5 in D major, Op. 70 No. 1", nick:"Ghost", m:"I. Allegro vivace e con brio",
   who:[["Claire Maugham","vn"],["Aaron Kinghorn","vc"],["Kian Woo","pf"]]},
  {c:"Beethoven", t:"String Quartet in F major, Op. 18 No. 1", m:"II. Adagio affettuoso ed appassionato",
   who:[["YooJin Jang","vn"],["Korn Roongruangchai","vn"],["Xinyuan Wang","va"],["Aaron Kinghorn","vc"]]},
  {c:"Kodály", t:"Serenade for Two Violins and Viola, Op. 12", m:"III. Vivo",
   who:[["Jane Givens","vn"],["Aafke Koffeman","vn"],["Gijs Kramers","va"]]},
  {brk:1},
  {c:"Schubert", t:"Piano Trio No. 1 in B-flat major, D. 898", m:"I. Allegro moderato",
   who:[["Cara Wunder","vn"],["Alison Atkinson","vc"],["Anne Schoemaker","pf"]]},
  {c:"Brahms", t:"Piano Trio No. 2 in C major, Op. 87", m:"I. Allegro moderato",
   who:[["Jisoo Kim","vn"],["Seah Yu","vc"],["Tanya Bannister","pf"]]},
  {c:"Bruch", t:"Eight Pieces, Op. 83", m:"III. Andante con moto · VI. Nachtgesang: Andante con moto",
   who:[["Robert Dembo","cl"],["Isadora Banyai","va"],["Daniel Compton","pf"]]},
  {c:"Shaw", t:"Thousandth Orange", m:"",
   who:[["Matthew Chan","vn"],["Xinyuan Wang","va"],["David Goldesgeyme","vc"],["Felicia Weiss","pf"]]},
 ]},
];

// Short rehearsal-style titles — the exact wording the live schedule sheet uses for each piece's
// rehearsals ("Bruch Octet", "Beethoven String Trio"), shown on the schedule's brass "you're
// performing" card so it reads the same as the day's rehearsal cards. Keyed by **composer + title**
// (`shortKey`, "Bruch | String Octet…"), NOT title alone — many program titles are generic ("Oboe
// Quartet", "Clarinet Quartet", "Portraits") and would collide across composers, silently handing a
// piece someone else's short name (the guard only checks that an `s` exists, not that it's the right
// one). Kept in ONE registry, deliberately NOT inline on each piece: a piece dropped from one
// concert's final PDF and moved into another's keeps its short name — the entry outlives the move,
// so re-adding it (same composer + title) reattaches `s` with no re-derivation. A piece in two
// concerts (Mendelssohn Op. 87) is named once. Not derivable from the title (the sheet is
// inconsistent — "Haydn Quartet" one day, "Haydn String Quartet" another; "Bruch Octet" drops
// "String" but "Beethoven String Trio" keeps it), so it's hand-kept in sync with the sheet. The
// concert-match-test guard fails if any performed piece resolves to no `s`, so a dropped or
// mistyped key surfaces loudly rather than shipping a blank card.
const shortKey = p => `${p.c} | ${p.t}`;
const SHORTS = {
  "Fauré | Piano Quartet No. 1 in C minor, Op. 15": "Fauré Piano Quartet",
  "Schumann | Piano Trio No. 2 in F major, Op. 80": "Schumann Piano Trio",
  "Larsen | Four on the Floor": "Larsen Four on the Floor",
  "Brahms | String Quintet No. 2 in G major, Op. 111": "Brahms String Quintet",
  "Shostakovich | String Quartet No. 9, Op. 117": "Shostakovich Quartet No. 9",
  "Casarrubios | luzAzul": "Casarrubios Piano Trio",
  "Brahms | String Sextet No. 1 in B-flat major, Op. 18": "Brahms Sextet",
  "Shostakovich | String Quartet No. 8 in C minor, Op. 110": "Shostakovich Quartet No. 8",
  "Grieg | String Quartet in G minor, Op. 27": "Grieg Quartet",
  "Bacewicz | Quartet for Four Violins": "Bacewicz Quartet",
  "Vokalensemble Singmazomm | Alpine songs — O sei gegrüßt Maria · Maria hell leuchtender Stern · Zwischen Himmel und Erde · Trag mi Wind · Abendstimmung": "Alpine songs (Singmazomm)",
  "Haydn | String Quartet in G major, Op. 76 No. 1": "Haydn Quartet",
  "Mozart · Mendelssohn | Ave verum corpus · Wirf dein Anliegen auf den Herrn — with Vokalensemble Singmazomm": "Ave verum · Wirf dein Anliegen",
  "Debussy | String Quartet in G minor, Op. 10": "Debussy Quartet",
  "Mendelssohn | String Quintet No. 2 in B-flat major, Op. 87": "Mendelssohn String Quintet",
  "Austrian folk song, arr. Stephen Buck | In die Berg bin i gern": "In die Berg bin i gern",
  "Kühr | Portraits": "Kühr Portraits",
  "arr. Gijs Kramers | Songs: Sammy · Ozean · Sternenstaub · Sie glaubt an mich · Schwarz-Weiß": "Songs, arr. Kramers",
  "Messiaen | Quartet for the End of Time": "Messiaen Quartet for the End of Time",
  "Mozart | Clarinet Quintet in A major, K. 581": "Mozart Clarinet Quintet",
  "Coleridge-Taylor | Clarinet Quintet in F-sharp minor, Op. 10": "Coleridge-Taylor Quintet",
  "Jacob | Oboe Quartet": "Jacob Oboe Quartet",
  "Korngold | Suite for Two Violins, Cello and Piano (left hand), Op. 23": "Korngold Suite",
  "Elgar | Piano Quintet in A minor, Op. 84": "Elgar Piano Quintet",
  "Ravel | Piano Trio in A minor, M. 67": "Ravel Piano Trio",
  "Beethoven | Piano Trio No. 5 in D major, Op. 70 No. 1": "Beethoven Piano Trio Op. 70 No. 1",
  "Beethoven | Piano Trio No. 6 in E-flat major, Op. 70 No. 2": "Beethoven Piano Trio Op. 70 No. 2",
  "Brahms | String Quartet No. 3 in B-flat major, Op. 67": "Brahms String Quartet",
  "Bruch | String Octet in B-flat major, Op. posth.": "Bruch Octet",
  "Ravel | String Quartet in F major, M. 35": "Ravel String Quartet",
  "Hindemith | Clarinet Quartet": "Hindemith Clarinet Quartet",
  "Arensky | String Quartet No. 2 in A minor": "Arensky Quartet",
  "Schumann | Piano Quartet in E-flat major, Op. 47": "Schumann Piano Quartet",
  "Brahms | Piano Quartet No. 1 in G minor, Op. 25": "Brahms Piano Quartet",
  "Beach | Piano Quintet in F-sharp minor, Op. 67": "Beach Piano Quintet",
  "Beethoven | String Trio in C minor, Op. 9 No. 3": "Beethoven String Trio",
  "Stravinsky | The Soldier's Tale (Histoire du soldat)": "Stravinsky Trio",
  "Brahms | Clarinet Quintet in B minor, Op. 115": "Brahms Clarinet Quintet",
  "Haydn | String Quartet in F minor, Op. 20 No. 5": "Haydn String Quartet",
  "Prokofiev | Quintet in G minor, Op. 39": "Prokofiev Quintet",
  "Kodály | Serenade for Two Violins and Viola, Op. 12": "Kodály Serenade",
  "Brahms | Clarinet Trio in A minor, Op. 114": "Brahms Clarinet Trio",
  "Dvořák | Piano Quintet No. 2 in A major, Op. 81": "Dvořák Piano Quintet",
  "Loeffler | Two Rhapsodies for Oboe, Viola and Piano": "Loeffler Two Rhapsodies",
  "Shostakovich | Five Pieces for Two Violins and Piano": "Shostakovich Five Pieces",
  "Beethoven | String Quartet in F major, Op. 18 No. 1": "Beethoven String Quartet",
  "Dvořák | String Quartet No. 14 in A-flat major, Op. 105": "Dvořák String Quartet",
  "Reinecke | Trio in A major, Op. 264": "Reinecke Trio",
  "Schubert | String Quintet in C major, D. 956": "Schubert Cello Quintet",
  "Schubert | Piano Quintet in A major, D. 667 (Trout)": "Schubert Trout Quintet",
  "Schubert | Piano Trio No. 1 in B-flat major, D. 898": "Schubert Piano Trio",
  "Bruch | Eight Pieces, Op. 83": "Bruch Eight Pieces",
  "Shaw | Thousandth Orange": "Shaw Thousandth Orange",
  "Brahms | Piano Trio No. 2 in C major, Op. 87": "Brahms Piano Trio",
};

// `day` is derived from each id's date — one source of truth, so a hand-typed heading can't
// contradict the id the schedule keys its cards on. `title` stays hand-set (Faculty vs Evening
// isn't derivable from the id). `s` is resolved from SHORTS by composer+title (undefined when
// unlisted → the schedule card falls back to `composer — t`).
const dayOf = id => new Date(+id.slice(0,4), +id.slice(5,7)-1, +id.slice(8,10))
  .toLocaleDateString("en-US", {weekday:"long", month:"long", day:"numeric"});
C.forEach(c => { c.day = dayOf(c.id); c.pieces.forEach(p => { if(!p.brk) p.s = SHORTS[shortKey(p)]; }); });

// --- printed name → roster person: the ONE matcher, shared by concerts.html's kudos chips and
// app.js's "you're performing" test (they used to be two copies, and drifted). Rules, in order:
//   1. exact normalized full name;
//   2. a printed full name may still match on surname — exact, or a trailing-letters wobble
//      ("Koffemann"/"Koffeman") — when the first names agree for ≥3 leading chars ("Stephen" ~
//      roster Steve, "Preetcharn" ~ roster Preet) and the instruments are compatible;
//   3. a bare first name matches its unique roster owner (exact, else a ≥3-char prefix),
//      instrument-checked.
// Anything ambiguous, or a full name with no surname counterpart on the roster (the 7/8 guest
// "Robert Lexer", flugelhorn — NOT Robert Dembo, clarinet), stays unmatched: never a wrong link,
// never someone else's brass card. Instrument compatibility comes from Roster.instKind when
// roster-data.js is around (violin/viola interchangeable, unknown permissive).
const norm = s => (s||"").normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase().replace(/\s+/g," ").trim();
const pre = (a,b,min) => (a.startsWith(b) || b.startsWith(a)) && Math.min(a.length,b.length) >= min;
const surOk = (a,b) => a===b || pre(a,b,4);
const firstOk = (a,b) => { let i=0; while(i<a.length && i<b.length && a[i]===b[i]) i++; return a===b || i>=3; };
function instOk(a,b){
  const K = g.Roster && g.Roster.instKind; if(!K) return true;
  const x = K(a), y = K(b); if(!x || !y) return true;          // unknown stays permissive
  const str = k => k==="v" || k==="va" || k==="v/va";
  return x===y || (str(x) && str(y));
}
function matcher(people){
  const full = new Map(), first = new Map(), ppl = [];
  for(const p of people||[]){
    const n = norm(p.name), f = n.split(" ")[0];
    full.set(n, p); first.set(f, first.has(f) ? null : p);     // null = ambiguous first, don't guess
    ppl.push({p, f, last: n.includes(" ") ? n.split(" ").pop() : ""});
  }
  return (name, inst) => {
    const n = norm(name), hit = full.get(n); if(hit) return hit;
    const t = n.split(" "), f = t[0], last = t.length>1 ? t[t.length-1] : "";
    let c;
    if(last) c = ppl.filter(x => x.last && surOk(x.last,last) && firstOk(x.f,f) && instOk(inst,x.p.instrument));
    else{
      const e = first.get(f);
      if(e !== undefined) return e && instOk(inst,e.instrument) ? e : null;
      c = ppl.filter(x => pre(x.f,f,3) && instOk(inst,x.p.instrument));
    }
    return c.length===1 ? c[0].p : null;
  };
}

// the schedule (app.js timeline) and concerts.html both read `all` and filter by `c.id`'s date
// prefix, placing each card at its own printed `time` — so a concert renders whether or not the
// day's sheet tab carries a CONCERT banner, and a banner's own (sometimes 12h) time can't misfile it.
g.Concerts = { all: C, matcher };
})();
