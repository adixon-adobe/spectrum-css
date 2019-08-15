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

function stripReference(value) {
  return value.replace(/(colorStopData|colorTokens|scaleData|dimensionTokens)\./g, '');
}

function getJSVariableReference(value) {
  let reference = stripReference(value);
  let parts = reference.split('.');
  return parts.shift() + parts.map(JSON.stringify).map(value => `[${value}]`).join('.');
}

function getExport(key, value) {
  if (value[0] === '$') {
    let reference = getJSVariableReference(value.substr(1));
    return `exports[${JSON.stringify(key)}] = ${reference};\n`;
  }
  else {
    return `exports[${JSON.stringify(key)}] = ${JSON.stringify(value)};\n`;
  }
}

function getCSSVariableReference(value) {
  // Strip the stop information
  value = value.replace(/colorStopData\..*?\.colorTokens\./, 'global-color.');
  value = value.replace(/colorStopData\..*?\.colorAliases\./, 'alias.');
  // Strip the scale information
  value = value.replace(/scaleData\..*?\.dimensionTokens\./, 'global-dimension.');
  value = value.replace(/scaleData\..*?\.dimensionAliases\./, 'alias.');
  // Sub in proper names for globals
  value = value.replace(/colorGlobals\./, 'global-color.');
  value = value.replace(/dimensionGlobals\./, 'global-dimension.');
  value = value.replace(/fontGlobals\./, 'global-font.');
  value = value.replace(/staticAliases\./, 'alias.');

  let parts = value.split('.');
  return '--spectrum-' + parts.join('-');
}

function getCSSVar(prefix, key, value) {
  key = prefix ? `${prefix}-${key}` : key;
  key = `--spectrum-${key}`;
  if (value[0] === '$') {
    let reference = getCSSVariableReference(value.substr(1));
    return `  ${key}: var(${reference});\n`;
  }
  else {
    return `  ${key}: ${value};\n`;
  }
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

  let dropTokens = {
    'name': true,
    'description': true,
    'status:': true,
    'varBaseName': true
  };

  const dnaJSONPath = path.join(path.dirname(require.resolve('@spectrum/spectrum-dna')), '..', 'dist', 'data', 'json', 'dna-linked.json');
  return gulp.src(dnaJSONPath)
    .pipe(through.obj(function translateJSON(file, enc, cb) {

      let pushFile = (contents, name, extension, folder) => {
        let vinylFile = file.clone({ contents: false });
        vinylFile.path = path.join(file.base, folder || '', `${name}.${extension}`);
        vinylFile.contents = Buffer.from(contents);
        this.push(vinylFile);
        dnaModules.push(name);
      };

      let generateCSSFile = (sections, fileName, folder) => {
        let contents = `:root {\n`;

        sections.forEach(section => {
          let prefix = section.varBaseName;
          for (let key in section) {
            if (dropTokens[key]) {
              continue;
            }

            let value = section[key];
            contents += getCSSVar(prefix, key, value);
          }
        });

        contents += `}\n`;

        pushFile(contents, 'spectrum-' + fileName, 'css', folder);
      };

      let generateJSFile = (sections, fileName, folder) => {
        let basePath = folder ? '../'.repeat(folder.split('/').length - 1) : './';
        let contents = `const ${fileName} = exports;\n`;
        let dependencies = {};

        sections.forEach(section => {
          for (let key in section) {
            if (dropTokens[key]) {
              continue;
            }

            let value = section[key];
            contents += getExport(key, value);

            if (value[0] === '$') {
              let dependency = stripReference(value.substr(1)).split('.').shift();
              if (dependency != fileName) {
                dependencies[dependency] = true;
              }
            }
          }
        });

        let requires = '';
        for (let dependency in dependencies) {
          requires += `const ${dependency} = require('${basePath}${dependency}.js');\n`;
        }

        pushFile(requires + contents, fileName, 'js', folder);
      };

      let generateFiles = (sections, fileName) => {
        generateCSSFile(sections, fileName, 'css');
        generateJSFile(sections, fileName, 'js');
      };

      let data = JSON.parse(String(file.contents));
      let dnaData = data.dna;

      // Globals
      flatVars.forEach(key => {
        generateJSFile([dnaData[key]], key, 'js');
        generateCSSFile([dnaData[key]], key, 'css');
      });

      // Stops
      for (let stopName in dnaData.colorStopData) {
        let stop = dnaData.colorStopData[stopName];
        if (stop.colorTokens.status === 'Deprecated') {
          continue;
        }

        generateFiles([
          stop.colorTokens,
          stop.colorAliases,
          stop.colorSemantics
        ], stopName);
      }

      // Scales
      for (let scaleName in dnaData.scaleData) {
        let scale = dnaData.scaleData[scaleName];

        generateFiles([
          scale.dimensionTokens,
          scale.dimensionAliases
        ], scaleName);
      }

      // Elements
      let stop = dnaData.elements[Object.keys(dnaData.elements)[0]];
      let scale = stop[Object.keys(stop)[0]];

      for (let elementName in scale) {
        let element = scale[elementName];
        for (let variantName in element) {
          let variant = element[variantName];
          let allVariables = {};

          if (variant.states) {
            let colorVariables = [];
            for (let stateName in variant.states) {
              let state = variant.states[stateName];
              for (let key in state) {
                let value = state[key];
                allVariables[key] = value;
                colorVariables[key] = value;
              }
            }
          }

          if (variant.dimensions) {
            let dimensionVariables = [];
            for (let key in variant.dimensions) {
              let value = variant.dimensions[key];
              allVariables[key] = value;
              dimensionVariables[key] = value;
            }

            generateJSFile([
              dimensionVariables
            ], elementName, 'js/components');
          }

          allVariables.varBaseName = variant.varBaseName;

          generateCSSFile([
            allVariables
          ], elementName, 'css/components');
        }
      }

      cb();
    }))
    .pipe(gulp.dest('./'))
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
