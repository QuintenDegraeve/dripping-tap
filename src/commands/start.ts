import { GluegunToolbox } from 'gluegun';
const Configstore = require('configstore');
import * as fs from 'fs';
import ora = require('ora');

const areSystemDepencenciesInstalled = ({ system }) => {
  const { which } = system;
  const isInstalled = (depencency) => which(depencency) !== null;

  return isInstalled('doctl') && isInstalled('wget');
}

const validator = {
  addRule: null
};

type ValidationDependencies = [ora.Ora, GluegunToolbox];

interface ValidationResponse {
  message: string;
  handler?: Function;
  options?: any;
}

interface ValidationParams {
  rule: Function;
  onValid: ValidationResponse;
  onInvalid: ValidationResponse;
}

validator.addRule = async (
  [spinner, toolbox]: ValidationDependencies,
  {
    rule,
    onValid,
    onInvalid
  }: ValidationParams
) => {
  const result = await rule.call(null, toolbox);
  const valid = typeof result !== 'object' ? result : result?.valid;

  if (valid) {
    spinner.succeed(onValid.message);
    await onValid?.handler?.(result?.payload);
  } else {
    spinner.fail(onInvalid.message);
    await onInvalid?.handler?.(result?.payload);
  }

  return valid;
}

module.exports = {
  name: 'run',
  alias: ['start'],
  run: async (toolbox: GluegunToolbox) => {
    const packageJson = JSON.parse(fs.readFileSync('./package.json', 'utf8'));
    const config = new Configstore(packageJson.name, { region: 'ams3', size: 's-1vcpu-2gb', dropletName: 'redm' });
    const spinner = toolbox.print.spin('Loading configuration');

    await toolbox.system.run('sleep 2');

    validator.addRule = validator.addRule.bind(null, [spinner, toolbox]);

    await validator.addRule({
      rule: areSystemDepencenciesInstalled,
      onValid: {
        message: 'System Depencencies installed'
      },
      onInvalid: {
        message: 'System Depencencies missing: %s',
        handler: async () => {
          if (await toolbox.prompt.confirm(
            `System dependencies have not been installed yet, do you want to install?`
          )) {
            await toolbox.system.run(`sudo apt-get update`);
            await toolbox.system.run(`sudo apt-get install wget`);

            const repository = 'https://github.com/digitalocean/doctl/releases/download/v1.72.0/';
            const archive = 'doctl-1.72.0-linux-amd64.tar.gz';
            await toolbox.system.run(`wget ${repository}${archive}`);
            await toolbox.system.run(`tar xf ./${archive}`);
            await toolbox.system.run(`sudo mv ~/doctl /usr/local/bin`);
          }
        }
      }
    });

    await validator.addRule({
      rule: async () => {
        const accounts = await toolbox.system.run(
          'doctl account get --format Email --no-header',
          { trim: true }
        );

        return accounts !== '';
      },
      onValid: {
        message: 'DigitalOcean Authenticated'
      },
      onInvalid: {
        message: 'DigitalOcean Not Authenticated'
      }
    });


    await validator.addRule({
      rule: async () => {
        const snapshots = await toolbox.system.run('doctl compute image list --format ID,Name,Type', { trim: true });

        return {
          valid: snapshots !== '',
          payload: snapshots
        }
      },
      onValid: {
        message: 'Snapshot(s) found',
      },
      onInvalid: {
        handler: async () => {
          toolbox.print.info(
            `${toolbox.print.colors.error('  ● ')}` + `At least 1 snapshot needs to be created to be able spin up a droplet`
          );

          toolbox.print.warning(
            `${toolbox.print.colors.error('  | ')}` + `Create the intial snapshot on the DigitalOcean Dashboard.`
          );

          process.exit();
        },
        message: 'No Snapshot(s) found'
      }
    });

    await validator.addRule({
      rule: async () => {
        //const ssh_host = await toolbox.system.config('ssh_host');

        return config.get('ssh_host');
      },
      onValid: {
        message: 'SSH host file found',
      },
      onInvalid: {
        handler: async () => {
          const { sshHostFile } = await toolbox.prompt.ask({
            name: 'sshHostFile',
            type: 'autocomplete',
            message: 'Enter SSH config path?',
            choices: [`${toolbox.filesystem.homedir()}/.ssh/config`],
            // You can leave this off unless you want to customize behavior
            suggest(s, choices) {
              return choices.filter(choice => {
                return choice.message.toLowerCase().startsWith(s.toLowerCase())
              })
            },
          });

          config.set('ssh_host', sshHostFile);

          return sshHostFile;
        },
        message: 'SSH host file not found'
      }
    });

    await validator.addRule({
      rule: async () => {
        //const fingerprint = await toolbox.system.config('finger');

        return config.get('fingerprint');
      },
      onValid: {
        message: 'SSH fingerprint found',
      },
      onInvalid: {
        handler: async () => {
          const { sshFingerprint } = await toolbox.prompt.ask({
            type: 'input',
            name: 'sshFingerprint',
            message: 'Enter SSH fingerprint?',
          });

          config.set('fingerprint', sshFingerprint);

          return sshFingerprint;
        },
        message: 'SSH fingerprint not found'
      }
    });

    const _createEnv = async () => {
      if (await toolbox.prompt.confirm(
        'Do you want to spin up a new droplet instance?'
      )) {
        const images = await toolbox.system.run(
          'doctl compute image list --format ID,Name,Type --no-header',
          { trim: true }
        );

        const options = images.split('\n')
          .map((image) => {
            const [id, name, type] = image.split(/\s+/);

            return { message: name, name: id, value: id, type: type };
          })
          .filter(({ type }) => type === 'snapshot');

        const askSnapshot = {
          type: 'select',
          name: 'snapshotSelect',
          message: 'What snapshot do you wan to use?',
          choices: options,
        };

        const result = await toolbox.prompt.ask(askSnapshot);
        const d = new Date();

        const snapshotId = result.snapshotSelect;
        const fingerprint = config.get('fingerprint');
        const region = config.get('region');
        const size = config.get('size');
        const sshHostFile = config.get('ssh_host');
        const version = `${d.getFullYear()}${("0"+(d.getMonth()+1)).slice(-2)}${("0"+d.getDate()).slice(-2)}` + "-" + d.getHours() + d.getMinutes();
        const dropletName = config.get('dropletName');

        const spinner = toolbox.print.spin('Spinning up droplet instance');

        const instance = await toolbox.system.run(
          `doctl compute droplet create --image ${snapshotId} --ssh-keys ${fingerprint} --region ${region} --size ${size} ${dropletName}-${version} --format ID,PublicIPv4 --no-header --wait`, 
          { trim: true }
        );

        const [ id, ip ] = instance.split(/\s+/);
        config.set('session', id);

        spinner.succeed(
          `Droplet up and running - Available at '${toolbox.print.colors.highlight(ip)}'`
        );

        if (sshHostFile) {
          const expression = new RegExp(`Host droplet:${dropletName}(\\r\\n|\\r|\\n)\\s*HostName \\S*`, 'g');

          await toolbox.patching.update(sshHostFile, data => 
            data.replace(expression, `Host droplet:${dropletName}\r\n    HostName ${ip}`)
          );

          toolbox.print.info(
            `SSH connection added to host file ${toolbox.print.colors.success(sshHostFile)} as ${toolbox.print.colors.highlight('droplet:' + dropletName)}`
          );
        }

        if (await toolbox.prompt.confirm(
          `Connect and start game server?`
        )) {

          // await toolbox.system.run(
          //   `alias ssh:cfx="ssh -t root@${ip} '~/cfx/data/remote-run.sh'" && alias ssh:ubuntu="ssh root@${ip}"`,
          //   { trim: true }
          // );

          toolbox.print.success(
            `\nFollowing commands are now available`
          );

          toolbox.print.info(
            `${toolbox.print.colors.highlight('Connect to CitizenFx RedM server:')} ssh -t root@${ip} '~/cfx/data/remote-run.sh'`
          );

          toolbox.print.info(
            `${toolbox.print.colors.highlight('Connect to Ubuntu server        :')} ssh root@${ip}`
          );

          /*await toolbox.system.run(
            `ssh -t root@${ip} '~/cfx/data/run.sh'`, 
            { trim: true }
          );*/

        }

      }
    };

    await validator.addRule({
      rule: async () => {
        const droplets = await toolbox.system.run(
          'doctl compute droplet list --format ID,Name,Memory,Disk,VCPUs,Status --no-header',
          { trim: true }
        );

        return {
          valid: droplets === '',
          payload: droplets
        };
      },
      onInvalid: {
        message: 'Conflicting droplet(s) found',
        handler: async (droplets) => {
          //  `new`, `active`, `off`, or `archive`
          const options = droplets.split('\n').map(
            (droplet) => {
              const [id, name, memory, disk, cpu, status] = droplet.split(/\s+/);

              return { id, name, memory, disk, cpu, status };
            }
          );

          var count = options.reduce(function (object, droplet) {
            object[droplet.status] = (object[droplet.status] || 0) + 1;
            object.total += 1;
            return object;
          }, {
            total: 0
          });

          toolbox.print.info(
            `${toolbox.print.colors.error('  ● ')}` + `${count.total} droplet(s) found, which ${count.active} are/is currently running`
          );

          if (count.new) {
            toolbox.print.info(
              `${toolbox.print.colors.error('  ● ')}` + `${count.new} droplet has recently been created`
            );
          }

          toolbox.print.warning(
            `${toolbox.print.colors.error('  | ')}` + `Droplet(s) should normally be ${toolbox.print.colors.error('destroyed')} after use.`
          );

          toolbox.print.warning(
            `${toolbox.print.colors.error('  | ')}` + 'To stop furthering dripping, destroy these via the dashboard.'
          );

          await _createEnv();
        }
      },
      onValid: {
        handler: _createEnv,
        message: 'No conflicting droplet(s) found'
      }
    });

    process.exit();
  },
}
