// QuickSpot configuration for the shared Ghost Assembly documentation checks.
export default {
    title: 'QuickSpot',
    site: 'https://ghost-assembly.com/quickspot/',
    repo: 'https://github.com/Ghost-Assembly/quickspot',
    sections: [
        ['overview', 'Overview'],
        ['install', 'Install'],
        ['uninstall', 'Uninstall'],
        ['player', 'Player setup and pairing'],
        ['playback', 'Playback controls'],
        ['library', 'Playlists and library login'],
        ['preferences', 'Preferences'],
        ['quality', 'Audio quality'],
        ['troubleshooting', 'Troubleshooting'],
        ['security', 'Storage and security'],
        ['architecture', 'Architecture'],
        ['testing', 'Testing'],
        ['packaging', 'Packaging'],
        ['releasing', 'Releasing'],
        ['development', 'Development'],
    ],
    drawing: async (shot, expect) => {
        for (const label of [
            'Previous',
            'Pause',
            'Next',
            'Use this device',
            'Shuffle',
            'Playlist shortcuts',
            'Liked Songs',
            'Your playlists',
            'Refresh playlists',
            'Stop player',
            'Open Spotify in browser',
            'QuickSpot settings',
        ]) {
            await expect(shot).toContainText(label);
        }
        await expect(shot.locator('.tile')).toHaveCount(0);
        await expect(shot).not.toContainText('lossless');
    },
};
