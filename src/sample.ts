export const SAMPLE_HTML = `<article>
  <header>
    <h1>Aurora Field Report</h1>
    <p class="meta">Station 14 &middot; Longyearbyen &middot; March 2026</p>
  </header>

  <p class="lede">
    Geomagnetic activity peaked at Kp 7 shortly after local midnight,
    producing sustained overhead coronal structure for just under an hour.
  </p>

  <h2>Observations</h2>
  <table>
    <thead>
      <tr><th>Time (UTC)</th><th>Kp</th><th>Notes</th></tr>
    </thead>
    <tbody>
      <tr><td>22:40</td><td>4</td><td>Faint arc, low northern horizon</td></tr>
      <tr><td>23:15</td><td>6</td><td>Arc brightens, first rays visible</td></tr>
      <tr><td>00:05</td><td>7</td><td>Corona directly overhead</td></tr>
      <tr><td>01:30</td><td>5</td><td>Diffuse glow, structure lost</td></tr>
    </tbody>
  </table>

  <h2>Conditions</h2>
  <p>
    Clear skies, &minus;24&deg;C, wind negligible. Battery performance
    degraded to roughly 40% of rated capacity within two hours.
  </p>

  <blockquote>
    The corona phase was bright enough to cast shadows on the snow.
  </blockquote>
</article>`;

export const SAMPLE_CSS = `@page {
  size: A4;
  margin: 20mm;
}

body {
  font-family: Georgia, "Times New Roman", serif;
  font-size: 11pt;
  line-height: 1.6;
  color: #1a1a1a;
  margin: 0;
}

header {
  border-bottom: 2px solid #1a1a1a;
  padding-bottom: 0.6em;
  margin-bottom: 1.4em;
}

h1 {
  font-size: 24pt;
  margin: 0 0 0.2em;
  letter-spacing: -0.01em;
}

.meta {
  margin: 0;
  font-size: 9pt;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #6b6b6b;
}

.lede {
  font-size: 13pt;
  line-height: 1.5;
  color: #333;
}

h2 {
  font-size: 12pt;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin: 1.8em 0 0.6em;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 10pt;
}

th {
  text-align: left;
  border-bottom: 1px solid #1a1a1a;
  padding: 0.4em 0.6em 0.4em 0;
}

td {
  border-bottom: 1px solid #e0e0e0;
  padding: 0.4em 0.6em 0.4em 0;
}

blockquote {
  margin: 1.4em 0 0;
  padding-left: 1em;
  border-left: 3px solid #d0d0d0;
  font-style: italic;
  color: #444;
}
`;
