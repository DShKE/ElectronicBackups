module.exports = {
  packagerConfig: {
    name: 'ElectronicBackups',
    executableName: 'ElectronicBackups',
    icon: './assets/icon',
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'ElectronicBackups',
        authors: 'Anon',
        description: 'File backupping thingy',
        setupIcon: './assets/icon.ico',
        createDesktopShortcut: true,
        createStartMenuShortcut: true,
      },
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['win32'],
    },
  ],
};