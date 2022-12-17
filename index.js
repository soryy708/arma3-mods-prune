const fs = require('fs');
const util = require('util');
const path = require('path');
const os = require('os');
const xml2js = require('xml2js');
const prettyBytes = require('pretty-bytes');
const moment = require('moment');
const chalk = require('chalk');

function pause() {
    return new Promise(resolve => {
        console.log('Press Enter to continue . . .');
        process.stdin.once('data', function () {
            resolve();
        });
    })
}

(async () => {
    const arma3LauncherFilesDirPath = path.join(os.homedir(), 'AppData', 'Local', 'Arma 3 Launcher');
    if (!await util.promisify(fs.exists)(arma3LauncherFilesDirPath)) {
        console.log(chalk.red('Unable to find Arma 3 launcher files directory'));
        return;
    }

    const getModData = async () => {
        const modDataFilePath = path.join(arma3LauncherFilesDirPath, 'Steam.json');
        if (!await util.promisify(fs.exists)(modDataFilePath)) {
            throw new Error(`File doesn\'t exist: ${modDataFilePath}`);
        }
        const modDataFileContent = await util.promisify(fs.readFile)(modDataFilePath, 'utf8');
        return JSON.parse(modDataFileContent);
    }

    const getPresets = async () => {
        const presetsDirPath = path.join(arma3LauncherFilesDirPath, 'Presets');
        if (!await util.promisify(fs.exists)(presetsDirPath)) {
            return [];
        }
        const presetFileNames = await util.promisify(fs.readdir)(presetsDirPath);
        return Promise.all(presetFileNames.map(async (fileName) => {
            const presetFilePath = path.join(presetsDirPath, fileName);
            const presetFileContent = await util.promisify(fs.readFile)(presetFilePath, 'utf8');
            const xmlContent = await xml2js.parseStringPromise(presetFileContent);
            return {
                name: fileName.slice(0, -1 * (fileName.endsWith('.preset2') ? '.preset2' : 'preset2').length),
                modIds: xmlContent['addons-presets']['published-ids'][0] !== '' ? xmlContent['addons-presets']['published-ids'][0].id : [],
                lastUpdate: new Date(xmlContent['addons-presets']['last-update'][0]),
            };
        }));
    };

    const getUsedModIds = (presets) => {
        let usedMods = {};
        presets.forEach(preset => {
            preset.modIds.forEach((modId) => {
                if (!usedMods[modId]) {
                    usedMods[modId] = true;
                }
            })
        });
        return Object.keys(usedMods);
    }

    const getUnusedModIds = (modData, usedModIds) => {
        const allModIds = modData.Extensions.map(extension => extension.Id);
        return allModIds.filter(modId => !usedModIds.includes(modId));
    }

    const getMod = (modData, modId) => {
        return modData.Extensions.find(extension => extension.Id === modId);
    };

    const [modData, presets] = await Promise.all([
        getModData(),
        getPresets(),
    ]);

    if (presets.length === 0) {
        console.log(chalk.red('No presets found.'));

    } else {
        const usedModIds = getUsedModIds(presets);
        const unusedModIds = getUnusedModIds(modData, usedModIds);

        if (unusedModIds.length > 0) {
            let totalWeight = 0;
            console.log(chalk.underline('Found subscribed mods not used in any preset:'));
            unusedModIds
                .map(modId => getMod(modData, modId))
                .sort((a, b) => b.FileSystemSpaceRequired - a.FileSystemSpaceRequired)
                .forEach(mod => {
                    const getColor = () => {
                        if (mod.FileSystemSpaceRequired < Math.pow(2, 20)) {
                            return chalk.green;
                        }
                        if (mod.FileSystemSpaceRequired < Math.pow(2, 30)) {
                            return chalk.yellow;
                        }
                        return chalk.red;
                    }
                    console.log(`"${mod.DisplayName}" by ${mod.Author} ( ${getColor()(prettyBytes(mod.FileSystemSpaceRequired))} )`);
                    totalWeight += mod.FileSystemSpaceRequired;
                });
            console.log(chalk.bold(`Total reclaimable space: ${prettyBytes(totalWeight)}`));
        }

        console.log('');

        const nonDefaultPresets = presets.filter(preset => preset.name !== 'arma3.default');
        if (nonDefaultPresets.length !== 0) {
            console.log(chalk.underline('Presets by age:'));
            nonDefaultPresets
                .sort((a, b) => a.lastUpdate - b.lastUpdate)
                .forEach(preset => {
                    const age = moment().diff(preset.lastUpdate, 'days');
                    const getColor = () => {
                        if (age < 7) {
                            return chalk.white;
                        }
                        if (age < 14) {
                            return chalk.green;
                        }
                        if (age < 60) {
                            return chalk.yellow;
                        }
                        return chalk.red;
                    };
                    console.log(`${preset.name} (${preset.modIds.length} mods) - last updated ${getColor()(moment(preset.lastUpdate).fromNow())}`);
                });
        }
    }
})()
    .then(pause)
    .then(() => {
        process.exit();
    })
    .catch(err => {
        console.log(chalk.red('Unexpected error occurred:'));
        console.log(chalk.red(err.toString()));
        console.log(chalk.red(err.stack));
    });
