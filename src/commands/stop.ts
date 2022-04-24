import { DrippingTapToolbox } from '../extensions/droplet-extension';

enum GAME_SERVER_STATUS {
    UP = 'UP',
    DOWN = 'DOWN'
}

module.exports = {
    name: 'down',
    alias: ['stop'],
    run: async (toolbox: DrippingTapToolbox) => {
        const { prompt, droplets, config, print, util } = toolbox;

        const session = config.userData.getSession();
        const version = util.timestamp();

        if (!session) {
            print.warning(`No session found - Exiting now.`);
            process.exit();
        }

        if (await prompt.confirm(
            util.color(`Do you want to shut down (destroy) previously created session $highlight[${session}]?`)
        )) {
            const shutdownSpinner = print.spin('Preparing droplet for snapshot');
            const status = await droplets.session.statusGameServer(session);

            if (status === GAME_SERVER_STATUS.UP) {
                shutdownSpinner.text = 'Shutting down Cfx server';
                await droplets.session.stopGameServer(session);
            }

            shutdownSpinner.text = 'Shutting down Ubuntu server';
            await droplets.session.shutdownServer(session);
            shutdownSpinner.succeed('Server shut down');

            const snapshotSpinner = print.spin(
                'Creating snapshot, this may take a while - approx. 2 minutes per gigabyte'
            );

            const snapshotId = await droplets.session.createSnapshot(session, version);
            if (snapshotId === '') {
                snapshotSpinner.fail('Failed to create snapshot');
                return;
            }

            snapshotSpinner.stop();

            config.userData.setPreviousSession(
                snapshotId,
                version
            )

            if (await prompt.confirm(
                util.color('$error[Warning:] Are you sure you want to delete this Droplet?')
            )) {
                await droplets.session.destroy(session);

                config.userData.setSession(null);
                print.warning(`Droplet has been destroyed.`);
            }
        }

        process.exit();
    }
}
