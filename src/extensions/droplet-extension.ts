const Configstore = require('configstore');
import * as fs from 'fs';
import { GluegunToolbox } from 'gluegun';

export interface DrippingTapToolbox extends GluegunToolbox {
    util: {
        timestamp: Function;
        color: Function;
    };
    ['config.userData']: {
        getSession: Function;
        setSession: Function;
        setPreviousSession: Function;
        getDropletName: Function;
    }
    droplets: {
        list: Function;
        session: {
            statusGameServer: Function;
            stopGameServer: Function;
            shutdownServer: Function;
            createSnapshot: Function;
            destroy: Function;
        }
    }
}

module.exports = toolbox => {
    const packageJson = JSON.parse(fs.readFileSync('./package.json', 'utf8'));
    const userData = new Configstore(packageJson.name, { region: 'ams3', size: 's-1vcpu-2gb', dropletName: 'redm' });

    toolbox.util = {
        timestamp: () => {
            const date = new Date();
            const year = date.getFullYear();
            const month = `0${(date.getMonth() + 1)}`.slice(-2);
            const day = `0${date.getDate()}`.slice(-2);
            const time = date.getHours() + date.getMinutes();

            return `${year}${month}${day}-${time}`;
        },
        color: (text) => {
            const regex = /\$(\S*)\[(.*?)\]/gm;
            
            return text.replaceAll(regex, (_match, color, text) => {
                if (toolbox.print.colors[color]) {
                    return toolbox.print.colors[color](text);
                }

                return text;
            });
        }
    }

    toolbox.config.userData = {
        getSession: () => {
            return userData.get('session');
        },
        setSession: (value) => {
            userData.set('session', value);
        },
        setPreviousSession: (snapshotId, version) => {
            const dropletName = userData.get('dropletName');
            userData.set('previousSession', `snapshot-${dropletName}-${version}`);
            userData.set('_previousSession', snapshotId);
        },
        getDropletName: () => {
            return userData.get('dropletName');
        }
    };

    toolbox.droplets = {
        list: async () => {
            return await toolbox.system.run(
                'doctl compute droplet list --format ID,Name,Memory,Disk,VCPUs,Status --no-header',
                { trim: true }
            );
        },
    }

    toolbox.droplets.session = {
        statusGameServer: async (instance) => {
            return await toolbox.system.run(
                `doctl compute ssh ${instance} --ssh-command '~/cfx/data/status.sh'`,
                { trim: true }
            );
        },
        stopGameServer: async (instance) => {
            return await toolbox.system.run(
                `doctl compute ssh ${instance} --ssh-command '~/cfx/data/stop.sh'`,
                { trim: true }
            );
        },
        shutdownServer: async (instance) => {
            return await toolbox.system.run(
                `doctl compute droplet-action shutdown ${instance} --wait`, { trim: true }
            );
        },
        createSnapshot: async (instance, version) => {
            const dropletName = toolbox.config.userData.getDropletName();

            return await toolbox.system.run(
                `doctl compute droplet-action snapshot ${instance} --snapshot-name snapshot-${dropletName}-${version} --format ID --no-header --wait`,
                { trim: true }
            );
        },
        destroy: async (instance) => {
            return await toolbox.system.run(
                `doctl compute droplet delete ${instance} --force`,
                { trim: true }
            );
        }
    }
}