const Balthazar = require('@spectrum/balthazar');
const path = require('path');
const fsp = require('fs').promises;
const gulp = require('gulp');
const ext = require('replace-ext');
const logger = require('gulplog');
const through = require('through2');

function generateDNAJSON() {
  const outputPath = path.resolve('temp/json/');
  const CSS_OUTPUT_TYPE = Balthazar.OUTPUT_TYPES.json;
  // the api for convert is destination, type, path-to-json
  // default path to json will look for node_modules/@spectrum/spectrum-dna locally
  const dnaPath = path.join(path.dirname(require.resolve('@spectrum/spectrum-dna')), '..');
  return Balthazar.convertVars(outputPath, CSS_OUTPUT_TYPE, dnaPath);
}

function getExport(key, value) {
  if (value[0] === '$') {
    let reference = processReference(value.substr(1));
    return `exports[${JSON.stringify(key)}] = ${reference};\n`;
  }
  else {
    return `exports[${JSON.stringify(key)}] = ${JSON.stringify(value)};\n`;
  }
}

function processReference(value) {
  let reference = value.replace(/(colorStopData|colorTokens|scaleData|dimensionTokens)\./g, '');
  let parts = reference.split('.');
  return parts.shift() + parts.map(JSON.stringify).map(value => `[${value}]`).join('.');
}

let dnaModules = [];
function generateDNAJS() {
  // Base variables we can just map directly
  let flatVars = [
    'colorGlobals',
    'fontGlobals',
    'dimensionGlobals',
    'animationGlobals',
    'staticAliases'
  ];

  const dnaJSONPath = path.join(path.dirname(require.resolve('@spectrum/spectrum-dna')), '..', 'dist', 'data', 'json', 'dna-linked.json');
  return gulp.src(dnaJSONPath)
    .pipe(through.obj(function translateJSON(file, enc, cb) {
      let pushFile = (name, contents) => {
        let jsFile = file.clone({contents: false});
        jsFile.path = path.join(file.base, `${name}.js`);
        jsFile.contents = Buffer.from(contents);
        this.push(jsFile);
        dnaModules.push(name);
      }

      let data = JSON.parse(String(file.contents));

      let dnaData = data.dna;

      // Globals
      flatVars.forEach(key => {
          let variables = dnaData[key];
          let contents = Object.keys(variables)
            .map(key => getExport(key, variables[key]))
            .join('');

          pushFile(key, contents);
        });

      // Stops
      for (let stopName in dnaData.colorStopData) {
        let stop = dnaData.colorStopData[stopName];
        if (stop.colorTokens.status === 'Deprecated') {
          continue;
        }

        let contents = '';

        // Allow self-reference
        contents += `var ${stopName} = exports;\n`;

        for (let token in stop.colorTokens) {
          contents += getExport(token, stop.colorTokens[token]);
        }

        for (let alias in stop.colorAliases) {
          contents += getExport(alias, stop.colorAliases[alias]);
        }

        for (let semantic in stop.colorSemantics) {
          contents += getExport(semantic, stop.colorSemantics[semantic]);
        }

        pushFile(stopName, contents);
      }

      // Scales
      for (let scaleName in dnaData.scaleData) {
        let scale = dnaData.scaleData[scaleName];

        let contents = '';

        // Allow self-reference
        contents += `var ${scaleName} = exports;\n`;

        for (let token in scale.dimensionTokens) {
          // skip name/description/varBaseName
          contents += getExport(token, scale.dimensionTokens[token]);
        }

        for (let alias in scale.dimensionAliases) {
          contents += getExport(alias, scale.dimensionAliases[alias]);
        }

        pushFile(scaleName, contents);
      }

      // Elements
      // ? lol

      cb();
    }))
    .pipe(gulp.dest('js/'))
}

async function generateDNAJSIndex() {
  await fsp.writeFile('js/index.js',
`${dnaModules.map(module => `exports[${JSON.stringify(module.replace(/^spectrum-(.*?)\.js/, '$1'))}] = require("./${module}.js");`).join('\n')}
`);
}

exports.updateDNAJS = gulp.series(
  generateDNAJSON,
  generateDNAJS,
  generateDNAJSIndex
);
