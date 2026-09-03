import type { CSSProperties } from "react";
import Effets from "./effets";
import "./vitrine.css";
import "./reveal.css";

/* La vitrine, portée telle quelle depuis agenda.html — même markup, même CSS.
   Ce qui change : elle est rendue par le serveur. Dans agenda.html elle vit
   dans un <div hidden> révélé en JS, donc invisible à l'indexation. */

/* Un seul endroit à changer le jour de la bascule : l'app passera à "/app". */
const APP = "https://agenda-five-sigma.vercel.app/";
const GUIDE = "https://agenda-five-sigma.vercel.app/guide.html";
const DEMO = "https://agenda-five-sigma.vercel.app/demo-classes.html";

export default function Vitrine() {
  return (
    <div id="landing">
        <div className="lp-bg" id="lp-bg" aria-hidden="true"><span className="mesh"></span><span className="spot"></span></div>
        <div className="lp-orbs" aria-hidden="true"><i className="o1"></i><i className="o2"></i><i className="o3"></i></div>

        <header className="lphead lp-nav">
          <span className="mk"><svg className="i" viewBox="0 0 24 24"><path d="M4 6h7M4 12h16M4 18h11"/></svg></span>
          <b>Agenda</b>
          <span className="grow"></span>
          <a className="lplink" href={GUIDE}>Guide d'installation</a>
          <a className="lplink" href={APP}>Se connecter</a>
          <a className="cta sm lp-cta" href={APP}>Créer mon compte</a>
        </header>

        <section className="lp-hero">
          <a className="lp-badge" href={DEMO} data-rev style={{"--d":"0ms"} as CSSProperties}>
            <b>Nouveau</b> Rejoins ta classe&nbsp;: discussions et notes partagées
            <svg className="i" viewBox="0 0 24 24"><path d="M9.5 5.5 16 12l-6.5 6.5"/></svg>
          </a>
          <h2 data-rev style={{"--d":"60ms"} as CSSProperties}>Tout ton cégep,<br /><span className="lp-grad">au même endroit.</span></h2>
          <p className="lp-lead" data-rev style={{"--d":"120ms"} as CSSProperties}>Tes notes, tes MIO, tes échéances, ton horaire, tes Moodle,
            tout est regroupé dans un seul agenda. Et ta classe au complet&nbsp;: discussions, notes partagées,
            documents annotés.</p>
          <div className="ctas lp-ctas" data-rev style={{"--d":"180ms"} as CSSProperties}>
            <a className="cta lp-cta" href={APP}>Créer mon compte
              <svg className="i" viewBox="0 0 24 24"><path d="M9.5 5.5 16 12l-6.5 6.5"/></svg></a>
            <a className="cta ghosty lp-ghost" href="#comment">Voir comment ça marche</a>
          </div>

          {/* Le produit, dessiné en HTML pur : rien à charger, rien à casser. */}
          <div className="lp-shot" data-rev style={{"--d":"120ms"} as CSSProperties}>
            <div className="lp-frame">
              <div className="lp-bar"><i></i><i></i><i></i><span>agenda-five-sigma.vercel.app</span></div>
              <div className="lp-ui">
                <aside>
                  <span className="lg"></span>
                  <span className="ln on"></span><span className="ln w7"></span><span className="ln w6"></span>
                  <span className="ln w8"></span><span className="ln w5"></span>
                  <span className="dotrow"><i style={{background:"#3FA457"} as CSSProperties}></i><i style={{background:"#2E7CD6"} as CSSProperties}></i><i style={{background:"#E8912B"} as CSSProperties}></i><i style={{background:"#D9539B"} as CSSProperties}></i></span>
                </aside>
                <div>
                  <div className="lp-hello"><b>Salut, Alex !</b><span>jeu. 20 août · session A26</span><em>Semaine suivante</em></div>
                  <div className="lp-cards">
                    <div className="c dark">
                      <span className="t">Aperçu de la session</span>
                      <div className="figs"><b>31<i>h</i></b><b>8<i>cours</i></b></div>
                      <span className="meter"><i></i></span>
                      <div className="tiles"><span className="on">18<i>Blocs</i></span><span>12<i>Échéances</i></span><span>13<i>MIO</i></span></div>
                    </div>
                    <div className="c">
                      <span className="t">Cette semaine</span>
                      <div className="bars">
                        <i style={{"--v":"38%"} as CSSProperties}></i><i style={{"--v":"74%"} as CSSProperties}></i><i style={{"--v":"52%"} as CSSProperties}></i>
                        <i className="on" style={{"--v":"88%"} as CSSProperties}><b>6 h</b></i><i style={{"--v":"64%"} as CSSProperties}></i><i style={{"--v":"14%"} as CSSProperties}></i><i style={{"--v":"8%"} as CSSProperties}></i>
                      </div>
                      <div className="days"><span>L</span><span>M</span><span>M</span><span className="on">J</span><span>V</span><span>S</span><span>D</span></div>
                    </div>
                    <div className="c">
                      <span className="t">Échéances</span>
                      <div className="row"><i style={{background:"#E0483A"} as CSSProperties}></i><div><b>Questionnaire médical</b><span className="cd" style={{color:"#C4392C"} as CSSProperties}>Dans 6 jours</span></div></div>
                      <div className="row"><i style={{background:"#E8912B"} as CSSProperties}></i><div><b>Actualité géographique 1</b><span className="cd" style={{color:"#A2620F"} as CSSProperties}>Dans 8 jours</span></div></div>
                      <div className="row"><i style={{background:"#3FA457"} as CSSProperties}></i><div><b>Examen 1 · Philo</b><span className="cd" style={{color:"#2E7D45"} as CSSProperties}>Dans 25 jours</span></div></div>
                      <div className="row"><i style={{background:"#3A6EA5"} as CSSProperties}></i><div><b>Rapport de laboratoire</b><span className="cd" style={{color:"#1C3D5D"} as CSSProperties}>Dans 32 jours</span></div></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="lp-float a" aria-hidden="true">
              <span className="ic"><svg className="i" viewBox="0 0 24 24"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M9 2.5h6"/></svg></span>
              <div><b>Collecte automatique</b><span>24 passages par jour</span></div>
              <svg className="spark" viewBox="0 0 84 26"><path d="M2 20 Q12 18 18 14 T34 12 T50 15 T66 7 T82 4" fill="none"/></svg>
            </div>
            <div className="lp-float b" aria-hidden="true">
              <span className="ic v"><svg className="i" viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7"/></svg></span>
              <div><b>Photo → horaire</b><span>18 blocs sur 18 lus</span></div>
            </div>
          </div>
        </section>

        <div className="lp-marq" data-rev aria-hidden="true"><div className="in">
          <span>Notes par cours</span><i>✦</i><span>MIO résumés</span><i>✦</i><span>Échéances datées</span><i>✦</i>
          <span>Horaire par photo</span><i>✦</i><span>Moodle regroupé</span><i>✦</i><span>Classes partagées</span><i>✦</i>
          <span>Notes par cours</span><i>✦</i><span>MIO résumés</span><i>✦</i><span>Échéances datées</span><i>✦</i>
          <span>Horaire par photo</span><i>✦</i><span>Moodle regroupé</span><i>✦</i><span>Classes partagées</span><i>✦</i>
        </div></div>

        <section className="lp-row" data-rev>
          <figure className="lp-pic">
            <img loading="lazy" src="/img/app-echeances.jpg" width="900" height="669"
                 alt="Les échéances, chacune avec son compte à rebours coloré" />
          </figure>
          <div className="txt">
            <span className="lp-kick" style={{"--k":"#D2503F"} as CSSProperties}>Échéances</span>
            <h3>L'urgence se calcule <em className="lp-grad">toute seule</em>.</h3>
            <p className="dim">Chaque remise et chaque évaluation arrive de Léa, datée et classée&nbsp;:
              du vert au rouge à mesure que la date approche.</p>
          </div>
        </section>

        <section className="lp-row flip" data-rev>
          <figure className="lp-pic">
            <img loading="lazy" src="/img/app-mios.jpg" width="1203" height="661"
                 alt="Les MIO résumés en une phrase, avec leurs actions proposées" />
          </figure>
          <div className="txt">
            <span className="lp-kick" style={{"--k":"var(--ac)"} as CSSProperties}>MIO</span>
            <h3>Chaque message, <em className="lp-grad">une phrase</em>.</h3>
            <p className="dim">L'agent lit les nouveaux MIO et en tire l'essentiel. L'action
              qui s'y cache devient une échéance d'un clic.</p>
          </div>
        </section>

        {/* Bandeau pleine largeur : l'horaire porte la pause à lui seul. */}
        <section className="lp-band" data-rev>
          <div className="lp-band-txt">
            <span className="lp-kick" style={{"--k":"var(--ac)"} as CSSProperties}>Horaire</span>
            <h3>Une photo, et chaque cours <em className="lp-grad">prend sa place</em>.</h3>
            <p className="dim">Heures réelles, locaux, professeurs. Vérifié : 18 blocs sur 18.</p>
          </div>
          <figure className="lp-band-pic">
            <img loading="lazy" src="/img/app-horaire-mini.jpg" width="1203" height="720"
                 alt="La grille d'horaire d'une semaine, chaque cours dans la couleur de sa matière" />
          </figure>
        </section>

        {/* Rangée notes : la page blanche par cours, et les documents qu'on annote.
             Pas de capture — la maquette est dessinée en HTML, comme celle du héro. */}
        <section className="lp-row" data-rev>
          <figure className="lp-pic">
            <div className="lp-nb" aria-hidden="true">
              <div className="tb"><i className="on"></i><i></i><i></i><i></i><em>PHY-NYB · séance 4</em></div>
              <b>Chute libre&nbsp;: l'essentiel</b>
              <span className="l w9"></span>
              <span className="l hl w7"></span>
              <span className="l w8"></span>
              <span className="l w5"></span>
              <svg className="pen" viewBox="0 0 220 60"><path d="M8 46 C40 12 74 54 108 30 S172 10 212 28"/></svg>
              <span className="anno">à revoir avant l'examen</span>
            </div>
          </figure>
          <div className="txt">
            <span className="lp-kick" style={{"--k":"#D9539B"} as CSSProperties}>Notes</span>
            <h3>Une page blanche <em className="lp-grad">par cours</em>.</h3>
            <p className="dim">Écris, dessine, surligne, annote&nbsp;: tes notes vivent juste à côté de l'horaire
              et des échéances. Importe tes documents (plan de cours, PDF, diapos) et prends
              tes notes directement dessus.</p>
          </div>
        </section>

        {/* Rangée classes : le code d'invitation ouvre la discussion et les notes partagées. */}
        <section className="lp-row flip" data-rev>
          <figure className="lp-pic">
            <div className="lp-cl" aria-hidden="true">
              <div className="hd"><b>Physique NYB</b><span>code R4KMT7 · 23 élèves</span></div>
              <div className="bub"><i>LB</i><div><b>Laurie</b><span>Quelqu'un a les notes de la séance 4&nbsp;?</span></div></div>
              <div className="bub me"><div><b>Toi</b><span>Je viens de les partager, schéma annoté inclus.</span></div></div>
              <div className="doc"><span className="ic"><svg className="i" viewBox="0 0 24 24"><path d="M3.5 7A2.5 2.5 0 0 1 6 4.5h3.6l2 2.5H18a2.5 2.5 0 0 1 2.5 2.5v7.5A2.5 2.5 0 0 1 18 19.5H6A2.5 2.5 0 0 1 3.5 17z"/></svg></span><div><b>Chute libre&nbsp;: l'essentiel</b><span>note partagée · séance 4</span></div></div>
            </div>
          </figure>
          <div className="txt">
            <span className="lp-kick" style={{"--k":"#2E7CD6"} as CSSProperties}>Classes</span>
            <h3>Un code, et ta classe <em className="lp-grad">met tout en commun</em>.</h3>
            <p className="dim">Rejoins ta classe par un code d'invitation&nbsp;: fil de discussion, notes de séance
              partagées, pages de révision par examen. Tout le monde y écrit, tout le monde y voit.</p>
            <a className="lp-more" href={DEMO}>Explorer une classe de démo
              <svg className="i" viewBox="0 0 24 24"><path d="M9.5 5.5 16 12l-6.5 6.5"/></svg></a>
          </div>
        </section>

        {/* Bande sombre : rupture franche après les sections claires. */}
        <section className="lp-dark" data-rev>
          <div className="lp-dark-head">
            <span className="lp-kick" style={{"--k":"var(--ac2)"} as CSSProperties}>Avant, après</span>
            <h3>Six écrans, ou <em className="lp-grad">un seul</em>.</h3>
          </div>
          <div className="lp-vs">
            <figure className="lp-vs-side whole">
              <span className="lp-tag av">Avant</span>
              <img loading="lazy" src="/img/omnivox-login.png" width="896" height="1280"
                   alt="Le formulaire de connexion d'Omnivox" />
              <figcaption>Connexion, code, Léa, un cours, l'onglet des travaux&#8230; puis pareil pour les MIO, puis pour Moodle.</figcaption>
            </figure>
            <span className="lp-arrow" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="M4 12h15M13 6l6 6-6 6"/></svg>
            </span>
            <figure className="lp-vs-side">
              <span className="lp-tag ap">Après</span>
              <img loading="lazy" src="/img/app-tableau.jpg" width="1800" height="1175"
                   alt="Le même contenu rassemblé sur un seul tableau de bord" />
              <figcaption>L'agent a fait le trajet pendant la nuit. Tout est daté, trié, résumé.</figcaption>
            </figure>
          </div>
        </section>

        {/* Étapes : un rail, pas trois cartes de plus. */}
        <div className="sect" id="comment" style={{paddingTop:"2.4rem"} as CSSProperties}><h2>Trois étapes, une fois</h2></div>
        <ol className="lp-rail">
          <li data-rev style={{"--d":"0ms"} as CSSProperties}><b>1</b><h4>Installe l'agent</h4><p className="dim">Une commande dans le Terminal.</p></li>
          <li data-rev style={{"--d":"110ms"} as CSSProperties}><b>2</b><h4>Il collecte, chaque heure</h4><p className="dim">Léa et MIO relus tout seuls.</p></li>
          <li data-rev style={{"--d":"220ms"} as CSSProperties}><b>3</b><h4>Ton agenda se remplit</h4><p className="dim">Et te suit partout.</p></li>
        </ol>

        {/* Bande sombre : la garantie ferme la page avant l'appel final. */}
        <section className="lp-dark tight" data-rev>
          <div className="lp-guar2">
            <div className="gh">
              <svg className="i" viewBox="0 0 24 24"><rect x="5" y="10.5" width="14" height="10" rx="3"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/></svg>
              <h3>La garantie, en trois phrases</h3>
            </div>
            <div className="gl">
              <p><b>Tes identifiants restent chez toi.</b> Un fichier local, sur ta machine.</p>
              <p><b>La double authentification n'est jamais contournée.</b> Le code, c'est toujours toi.</p>
              <p><b>Ton compte ne transporte que le résultat.</b> Échéances et résumés, rien d'Omnivox.</p>
            </div>
          </div>
        </section>

        <section className="lp-final" data-rev>
          <i className="fo1" aria-hidden="true"></i><i className="fo2" aria-hidden="true"></i>
          <h2>Ton prochain lundi matin<br />peut déjà être trié.</h2>
          <p>Un courriel, un mot de passe, une commande. Le premier écran rempli arrive
            à la collecte suivante.</p>
          <div className="ctas">
            <a className="cta lp-cta inv" href={APP}>Créer mon compte
              <svg className="i" viewBox="0 0 24 24"><path d="M9.5 5.5 16 12l-6.5 6.5"/></svg></a>
            <a className="cta ghosty lp-ghost inv" href={GUIDE}>Guide d'installation</a>
          </div>
        </section>

        <footer className="lpfoot">
          <span>Agenda Cégep&nbsp;: outil personnel, non affilié au Cégep de Trois-Rivières ni à Skytech.</span>
          <span className="grow"></span>
          <a href={GUIDE}>Guide d'installation</a>
        </footer>

      <Effets />
    </div>
  );
}
