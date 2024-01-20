'use strict'

const { app, shell, BrowserWindow, ipcMain } = require('electron')

const fs = require('fs')
const util = require('util');
const path = require('path')
const os = require('os')
const cp = require('child_process')
// do NOT uncomment unless win is in use.
// be aware that win being in use causes errors for some machines (namely Brennan)
// work with tyster/Brennan if you need this module or look for something else
// this was in use for registry access before being commented
//const win = require('windows') 

const axios = require('axios')
const unzipper = require('unzipper')

// normally we would keep this on but since the Installer + Launcher + Updater are all
// one app, we can't do this. maybe we can find a custom way to handle this but for now
// we are just turning this off so we can launch the updater from the launcher etc etc
//if (!app.requestSingleInstanceLock())
//	return app.quit()

// got crashes when trying to delete .asar files during update/install processes
// https://github.com/electron/electron/issues/1658#issuecomment-424509232
process.noAsar = true
// unsure if we need to be setting this to false again later, so far it seems to work

if (os.platform() !== 'win32' && os.platform() !== 'darwin')
	cp.exec('xdg-mime default wtb.desktop x-scheme-handler/wtb')

let foundUri = false
const args = {
	launchType: '',
	worldID: 0,
	userKey: 'none',
	roomID: 0
}

function getUri() {
	var uri = 'wtb:'
	uri += args.launchType
	uri += ':' + args.worldID
	uri += ':' + args.userKey
	uri += ':' + args.roomID
	return uri
}

let cachedArgs = process.argv

// the purpose of this is to put the URI scheme at the end
function formatArguments() {
	var formattedArgs = cachedArgs.filter(function(value, index, arr) {
		if (value.startsWith('wtb:')) {
			return false
		} else {
			return true
		}
	})
	formattedArgs.push(getUri())
	
	return formattedArgs
}

for (let i = 0; i < cachedArgs.length; i++) {
	const arg = cachedArgs[i].toLowerCase()

	if (!arg.startsWith('wtb'))
		continue

	let parsed
	if (arg.startsWith('wtb://')) {
		parsed = arg.replace('wtb://', '').split(':')
	} else {
		parsed = arg.replace('wtb:', '').split(':')
	}

	if (parsed.length > 0) {
		foundUri = true
	}

	args.launchType = parsed[0]
	args.worldID = parsed[1]
	args.userKey = parsed[2]
	args.roomID = parsed[3]

	break
}

let sandbox = 'live'

let subsumed = false

let platform
let playerFolder, playerPath, playerTemp
let launcherFolder, launcherPath, launcherTemp
let updaterFolder, updaterPath

let appData = app.getPath('appData')
let worldToBuildFolder = appData + '/worldtobuild'

let settingsFile = worldToBuildFolder + '/settings.json'
let logFile = worldToBuildFolder + '/launcher.log'

playerFolder = worldToBuildFolder + '/Player'
playerTemp = worldToBuildFolder + '/Player.temp'
launcherFolder = worldToBuildFolder + '/Launcher'
launcherTemp = worldToBuildFolder + '/Launcher.temp'

if (os.platform() === 'win32') {
	platform = 'windows';
	playerPath = worldToBuildFolder + '/Player/WorldtoBuild.exe';
	launcherPath = worldToBuildFolder + '/Launcher/Launcher.exe';
	updaterFolder = worldToBuildFolder + '/Updater'
	updaterPath = updaterFolder + '/Launcher.exe'
}
else if (os.platform() === 'darwin') {
	platform = 'macos';
	playerPath = worldToBuildFolder + '/Player/WorldtoBuild.app/Contents/MacOS/WorldtoBuild';
	launcherPath = worldToBuildFolder + '/Launcher/Launcher.app/Contents/MacOS/Launcher';
	updaterFolder = worldToBuildFolder + '/Updater'
	updaterPath = updaterFolder + '/Launcher.app/Contents/MacOS/Launcher'
}
else {
	platform = 'linux';
	playerPath = worldToBuildFolder + '/Player/WorldtoBuild.x86_64';
	launcherPath = worldToBuildFolder + '/Launcher/Launcher.x86_64';
	updaterFolder = worldToBuildFolder + '/Updater'
	updaterPath = updaterFolder + '/Launcher.x86_64'
}

var log_file = fs.createWriteStream(logFile, {flags : 'w'})
var log_stdout = process.stdout
function log(msg) {
	log_file.write(util.format(msg) + '\n')
	log_stdout.write(util.format(msg) + '\n')
	console.log(msg)
}
log('--> new log (' + Date.now() + ')')

let window

function createWindow() {
	window = new BrowserWindow({
		width: 600,
		height: 350,
		title: 'World to Build Launcher',
		backgroundColor: '#00000000',
		frame: false,
		transparent: true,
		resizable: false,
		show: false,
		webPreferences: {
			devTools: true,
			nodeIntegration: false,
			preload: path.join(app.getAppPath(), 'launcher.js'),
			webgl: false,
			contextIsolation: true,
			enableRemoteModule: true
		}
	})

	window.setAlwaysOnTop(true)
	window.loadFile('index.html')

	window.on('ready-to-show', () => {
		window.show()
	})

	window.webContents.on('dom-ready', () => {
		window.webContents.send('fadeIn')
	})

	window.webContents.on('did-finish-load', () => {
		initialize()
	})
}

function getSettings() {
	let fileData = {}

	if (fs.existsSync(settingsFile))
		fileData = JSON.parse(fs.readFileSync(settingsFile))

	return fileData
}

function applySettings(data) {
	log("applySettings")
	fs.writeFileSync(settingsFile, JSON.stringify({...getSettings(), ...data}))
}

function alert(msg) {
	log("ALERT: " + msg)
	window.webContents.send('alert', msg)
}

async function updateThenPlay() {
	log("updateThenPlay")

	updateRegistry()
	
	const settingsData = getSettings()
	if (!settingsData) {
		return alert('Failed to check for updates. (1)')
	}

	let updatesData = await getVersions()
	if (!updatesData) {
		return alert('Failed to check for updates. (2)')
	}

	if (settingsData.LauncherVersion !== updatesData.LauncherVersion) {
		updateLauncher(updatesData.LauncherVersion)
	} else {
		if (fs.existsSync(updaterFolder)) {
			fs.rmdirSync(updaterFolder, {recursive: true})
		}

		if (settingsData.PlayerVersion !== updatesData.PlayerVersion) {
			downloadPlayer(updatesData.PlayerVersion, () => {
				launchPlayer()
			})
		} else {
			launchPlayer()
		}
	}
}

function cleanOldWTBContent() {
	log("cleanOldWTBContent")

	// you can't remove this entire folder without accidentally breaking the launcher.log write stream
	// https://github.com/nodejs/node/issues/18274
	//if (fs.existsSync(worldToBuildFolderOld))
	//	fs.rmdirSync(worldToBuildFolderOld, {recursive: true})
}

function runExeAndQuit(path, delayInMs) {
	log("runExeAndQuit")

	try {
		gotoPage('loading', () => {
			cp.spawn(path, formatArguments(), {detached: true, stdio: 'ignore'})
			setTimeout(() => {
				appQuit()
			}, delayInMs)
		})
	} catch (err) {
		log(err)
		alert('Unable to spawn child process.')
	}
}

async function installAll() {
	log("installAll")

	cleanOldWTBContent()
	updateRegistry()

	let updatesData = await getVersions()
	if (!updatesData)
		return alert('Failed to install. (2)')

	downloadLauncher(updatesData.LauncherVersion, () => {
		if (fs.existsSync(launcherFolder)) {
			fs.rmdirSync(launcherFolder, {recursive: true})
		}
		fs.mkdirSync(launcherFolder)
		
		extractDownload(fs.createReadStream(launcherTemp), 'Installing Launcher..', 'Install Launcher complete', launcherFolder, true, () => {
			applySettings({LauncherVersion: updatesData.LauncherVersion})
			downloadPlayer(updatesData.PlayerVersion, () => {
				gotoPage('install-complete', () => {})
			})
		})
	})
}

function uninstall() {
	log("uninstall")

	gotoPage('loading-bar', () => {
		// tried some async stuff but gave up, it's such a fast operation anyways this is fine for now
		window.webContents.send('setLoadingBarProgress', 99)
		window.webContents.send('setLoadingBarSubtext', 'Uninstalling..')

		cleanRegistry()
		cleanOldWTBContent()

		try {
			if (fs.existsSync(launcherTemp))
				fs.unlinkSync(launcherTemp)
				
			if (fs.existsSync(playerTemp))
				fs.unlinkSync(playerTemp)
		} catch (err) {
			log(err)
			return alert('Issue with uninstall. (2) (You can manually remove the entirety of World to Build be deleting this folder: ' + worldToBuildFolder + ')')
		}

		try {
			if (fs.existsSync(launcherFolder)) {
				fs.rmdirSync(launcherFolder, {recursive: true})
			}
		} catch (err) {
			log(err)
			return alert('Issue with uninstall. (1) (You can manually remove the entirety of World to Build be deleting this folder: ' + worldToBuildFolder + ')')
		}
	
		try {
			if (fs.existsSync(playerFolder))
				fs.rmdirSync(playerFolder, {recursive: true})
		} catch (err) {
			return alert('Issue with uninstall. (3) (You can manually remove the entirety of World to Build be deleting this folder: ' + worldToBuildFolder + ')')
		}

		try {
			if (fs.existsSync(settingsFile))
				fs.unlinkSync(settingsFile)
		} catch (err) {
			log(err)
			return alert('Issue with uninstall. (4) (You can manually remove the entirety of World to Build be deleting this folder: ' + worldToBuildFolder + ')')
		}
	
		setTimeout(() => {
			gotoPage('uninstall-complete', () => {})
		}, 1000)
	})
}

async function getVersions() {
	log("getVersions")

	let updatesData

	try {
		const response = await axios.get('https://api.worldtobuild.com/GameService/FetchVersions?Sandbox=' + sandbox, {headers: {Authorization: args.userKey}})

		if (!response.data.Success)
			return alert('Failed to get live version data. (2)')

		updatesData = response.data.Data
	}
	catch {
		return alert('Failed to get live version data. (1)')
	}

	return updatesData
}

// check if this (the currently running app) is the application in the migration destination
function checkSelfMigrated() {
	if (!checkAnyMigrated()) {
		return false
	}

	let myPath = cachedArgs[0]
	if (myPath.replaceAll('/', '\\') == launcherPath.replaceAll('/', '\\')) {
		return true
	}

	return false
}

// check if any launcher app is in the migration destination
function checkAnyMigrated() {
	return fs.existsSync(launcherPath)
}

// run the launcher in the migration destination and close this instance
async function subsumeIntoMigratedLauncher() {
	log("subsumeIntoMigratedLauncher")

	gotoPage('loading', () => {
		setTimeout(() => {
			if (!fs.existsSync(launcherPath))
				return alert('Unable to locate the launcher installation. (1)')
	
			if (!subsumed) {
				try {
					cachedArgs.push('--subsumed') // so we don't spam relaunch if the path comparison goes wrong (happened during dev and I have ptsd)
					runExeAndQuit(launcherPath, 100)
				} catch (err) {
					log(err)
					alert('Unable to run updater. (1)')
				}
			} else {
				gotoPage('loading', () => {
					alert('Unable to locate the launcher installation. (2)')
				})
			}
		}, 500)
	})
}

async function updateLauncher(version) {
	log("updateLauncher(" + version + ")")

	downloadLauncher(version, () => {
		if (fs.existsSync(updaterFolder)) {
			fs.rmdirSync(updaterFolder, {recursive: true})
		}

		fs.mkdirSync(updaterFolder)

		extractDownload(fs.createReadStream(launcherTemp), '(1/2) Extracting updates to Launcher..', '(1/2) Extract Launcher updates complete', updaterFolder, false, () => {
			try {
				cachedArgs.push('--updater=' + version)
				runExeAndQuit(updaterPath, 100)
			} catch (err) {
				log(err)
				alert('Unable to run updater. (2)')
			}
		})
	})
}

async function migrateLauncherTemp(version) {
	log("migrateLauncherTemp(" + version + ")")

	gotoPage('loading', () => {
		setTimeout(() => { // give a nice long delay so the Launcher can close itself nicely before we kill the folder
			try {
				if (fs.existsSync(launcherFolder)) {
					fs.rmdirSync(launcherFolder, {recursive: true})
				}
			} catch (err) {
				log(err)
				alert('Unable to run updater. (3)')
			}
		
			try {
				fs.mkdirSync(launcherFolder)
			} catch (err) {
				// this hits consistently for some reason (1/23/2021) and I can't be bothered to fix it
				// this is a problem because files that are not longer in use could be left over in the launcher folder
				// ex. POOPY.txt, out.log, unused assets maybe(?)
				// I bothered to fix it, the issue is that the Launcher folder is still in use by something, tried:
				// - using exit(0) to close the launcher before running updater
				// - setting a longer delay (5000ms/5s) before deleting the directory
				// - complaining about it outloud
			}
		
			// assuming the updater is running when it's supposed to, the launcher .temp file is still there :^)
			extractDownload(fs.createReadStream(launcherTemp), '(2/2) Installing updates to Launcher..', '(2/2) Install Launcher updates complete', launcherFolder, true, () => {
				try {
					applySettings({LauncherVersion: version})
		
					var filteredArgs = cachedArgs.filter(function(value, index, arr) {
						if (value.startsWith('--updater')) {
							return false
						} else {
							return true
						}
					})
					cachedArgs = filteredArgs
		
					runExeAndQuit(launcherPath, 100)
				} catch (err) {
					log(err)
					alert('Unable to run updater. (4)')
				}
			})
		}, 500);
	})
}

async function downloadLauncher(version, onFinished) {
	log("downloadLauncher(" + version + ")")

	try {
		gotoPage('loading-bar', () => {})
	} catch (err) {
		log(err)
		return alert('Failed to update the launcher. (0)')
	}

	let fetchData

	try {
		const response = await axios.get('https://api.worldtobuild.com/GameService/FetchLauncherExecutableByVersion?Version=' + version, {headers: {Authorization: args.userKey}})

		if (!response.data.Success)
			return alert('Failed to update the launcher. (2)')

		fetchData = response.data.Data
	} catch (err) {
		log(err)
		return alert('Failed to update the launcher. (1)')
	}

	try {
		if (!fs.existsSync(worldToBuildFolder))
			fs.mkdirSync(worldToBuildFolder)		

		if (fs.existsSync(launcherTemp))
			fs.unlinkSync(launcherTemp)
	} catch (err) {
		log(err)
		return alert('Failed to update the launcher. (3)')
	}
	
	let downloadData, totalBytes, completeBytes
	let response

	try {
		response = await axios.get(fetchData.Link, {headers: {Authorization: args.userKey}, responseType: 'stream'})
		downloadData = response.data

		totalBytes = response.headers['content-length']
		completeBytes = 0

		if (totalBytes == 0) {
			totalBytes = 1
		}
	} catch (err) {
		log(err)
		return alert('Failed to update the launcher. ((1) Known high-priority bug with Windows Defender users (2/10/2022))')
	}

	log('totalBytes = ' + totalBytes)

	try {
		response.data.on('data', (chunk) => {
			completeBytes += chunk.length
			let progress = completeBytes / totalBytes * 100
			window.webContents.send('setLoadingBarProgress', progress)
			window.webContents.send('setLoadingBarSubtext', 'Downloading Launcher..')
			window.webContents.send('setOutput', byteAsPrettyString(completeBytes) + " / " + byteAsPrettyString(totalBytes))
		})
	} catch (err) {
		log(err)
		return alert('Failed to update the launcher. ((2) Known high-priority bug with Windows Defender users (2/10/2022))')
	}

	downloadData.on('end', _ => {
		window.webContents.send('setLoadingBarProgress', 100)
		window.webContents.send('setLoadingBarSubtext', 'Download Launcher complete')
		window.webContents.send('setOutput', byteAsPrettyString(totalBytes) + " / " + byteAsPrettyString(totalBytes))

		setTimeout(() => {
			onFinished()
		}, 500)
	})

	downloadData.pipe(fs.createWriteStream(launcherTemp))
}

async function downloadPlayer(version, onFinished) {
	log("downloadPlayer(" + version + ")")

	let fetchData

	try {
		const response = await axios.get('https://api.worldtobuild.com/GameService/FetchClientPlayerExecutableByVersion?Version=' + version, {headers: {Authorization: args.userKey}})

		if (!response.data.Success)
			return alert('Failed to update the player. (2)')

		fetchData = response.data.Data
	} catch (err) {
		log(err)
		return alert('Failed to update the player. (1)')
	}
	
	try {
		if (!fs.existsSync(worldToBuildFolder))
			fs.mkdirSync(worldToBuildFolder)

		if (fs.existsSync(playerFolder))
			fs.rmdirSync(playerFolder, {recursive: true})

		fs.mkdirSync(playerFolder)

		if (fs.existsSync(playerTemp))
			fs.unlinkSync(playerTemp)
	} catch (err) {
		log(err)
		return alert('Failed to update the player. (3)')
	}

	let downloadData, totalBytes, completeBytes
	let response

	try {
		gotoPage('loading-bar', () => {})

		response = await axios.get(fetchData.Link, {headers: {Authorization: args.userKey}, responseType: 'stream'})
		downloadData = response.data

		totalBytes = response.headers['content-length']
		completeBytes = 0

		if (totalBytes == 0) {
			totalBytes = 1
		}
	} catch (err) {
		log(err)
		return alert('Failed to update the player. ((1) Known high-priority bug with Windows Defender users (2/10/2022))')
	}

	log('totalBytes = ' + totalBytes)

	try {
		response.data.on('data', (chunk) => {
			completeBytes += chunk.length
			let progress = completeBytes / totalBytes * 100
			window.webContents.send('setLoadingBarProgress', progress)
			window.webContents.send('setLoadingBarSubtext', 'Downloading Player..')
			window.webContents.send('setOutput', byteAsPrettyString(completeBytes) + " / " + byteAsPrettyString(totalBytes))
		})
	} catch (err) {
		log(err)
		return alert('Failed to update the player. ((2) Known high-priority bug with Windows Defender users (2/10/2022))')
	}

	downloadData.on('end', _ => {
		window.webContents.send('setLoadingBarProgress', 100)
		window.webContents.send('setLoadingBarSubtext', 'Download Player complete')
		window.webContents.send('setOutput', byteAsPrettyString(totalBytes) + " / " + byteAsPrettyString(totalBytes))

		setTimeout(() => {
			extractDownload(fs.createReadStream(playerTemp), 'Installing Player..', 'Install Player complete', playerFolder, true, () => {
				applySettings({PlayerVersion: version})
				onFinished()
			})
		}, 500)
	})

	downloadData.pipe(fs.createWriteStream(playerTemp))
}

async function extractDownload(stream, subtext, completeSubtext, unzipPath, unlinkWhenDone, onFinished) {
	log("extractDownload")

	gotoPage('loading-bar', () => {})
	window.webContents.send('setLoadingBarProgress', 0)
	window.webContents.send('setLoadingBarSubtext', subtext)

	const extract = stream.pipe(unzipper.Extract({path: unzipPath}))

	let totalBytes = fs.statSync(stream.path).size
	let completeBytes = 0

	if (totalBytes == 0) {
		totalBytes = 1
	}

	stream.on('data', (chunk) => {
		completeBytes += chunk.length
		let progress = completeBytes / totalBytes * 100
		window.webContents.send('setLoadingBarProgress', progress)
		window.webContents.send('setOutput', byteAsPrettyString(completeBytes) + " / " + byteAsPrettyString(totalBytes))
	})

	extract.on('finish', () => {	
		window.webContents.send('setLoadingBarProgress', 100)
		window.webContents.send('setLoadingBarSubtext', completeSubtext)
		window.webContents.send('setOutput', byteAsPrettyString(totalBytes) + " / " + byteAsPrettyString(totalBytes))
		setTimeout(() => {
			if (unlinkWhenDone) {
				fs.unlinkSync(stream.path)
			}
			onFinished()
		}, 500)
	})
}

function launchPlayer() {
	log("launchPlayer")

	gotoPage('loading', () => {
		if (!fs.existsSync(playerPath))
			return alert('Unable to locate the player installation.')

		runExeAndQuit(playerPath, 2500)
	})
}

function byteAsPrettyString(bytes) {
	return (Math.round(bytes / 1000)).toLocaleString() + " KB"
}

app.on('window-all-closed', _ => app.quit())

function appQuit() {
	log("appQuit")
	gotoPage('index', () => {
		app.quit()
	})
}

app.whenReady().then(createWindow)

app.on('activate', () => {
	if (BrowserWindow.getAllWindows().length === 0)
		createWindow()
})

app.on('open-url', (event, url) => {
	event.preventDefault()
	cachedArgs.push(url)
})

ipcMain.on('install', (event) => {
	gotoPage('tos', () => {})
});

ipcMain.on('uninstall', (event) => {
	uninstall()
});

ipcMain.on('tosnext', (event) => {
	if (!checkSelfMigrated()) {
		installAll()
	} else {
		alert('Couldn\'t start installation.')
	}
});

ipcMain.on('close', (event) => {
	appQuit()
});

ipcMain.on('browseworlds', (event) => {
	shell.openExternal('https://www.worldtobuild.com/worlds/browse')
	appQuit()
});

let currentPage = 'index'
function gotoPage(page, onLoaded) {
	log("gotoPage(" + page + ")")
	if (currentPage != page) {
		currentPage = page
		window.webContents.send('gotoPage', page)
		setTimeout(() => {
			onLoaded()
		}, 500)
	} else {
		onLoaded()
	}
}

function output(message) {
	log('output: ' + message)
	//window.webContents.send('setOutput', message)

	// log to a file here
}

ipcMain.on('pageLoaded', (event, page) => {

})

function updateRegistry() {
	log("updateRegistry")
	app.setAsDefaultProtocolClient('wtb', launcherPath)

	/*
	if (os.platform() == 'win32') {
		const uninstallRegistryPath = 'HKEY_CURRENT_USER/SOFTWARE/Microsoft/Windows/CurrentVersion/Uninstall'
		const uninstallString = launcherPath + ' --uninstall'

		var reg = win.registry(uninstallRegistryPath)
		if (!reg.WorldtoBuild) {
			reg.add('WorldtoBuild')
		}
		reg = win.registry(uninstallRegistryPath + '/WorldtoBuild')

		if (!reg.DisplayName) reg.add('DisplayName', 'World to Build')
		if (!reg.UninstallString) reg.add('UninstallString', uninstallString)
		if (!reg.DisplayIcon) reg.add('DisplayIcon', launcherPath) // apparently this works
		if (!reg.InstallLocation) reg.add('InstallLocation', launcherFolder)
	}
	*/
}

function cleanRegistry() {
	log("cleanRegistry")
	app.removeAsDefaultProtocolClient('wtb')

	/*
	if (os.platform() == 'win32') {
		const uninstallRegistryPath = 'HKEY_CURRENT_USER/SOFTWARE/Microsoft/Windows/CurrentVersion/Uninstall'

		var reg = win.registry(uninstallRegistryPath)
		if (reg.WorldtoBuild) {
			reg.WorldtoBuild.remove()
		}
	}
	*/
}

function initialize() {
	log("initialize")

	// app.getVersion() shows the electron version only when testing - in release it will be the version we set
	// https://github.com/electron/electron/issues/7085#issuecomment-244584704
	window.webContents.send('setWatermark', 'v' + app.getVersion() + ' release')

	let cancelInit = false

	cachedArgs.forEach(arg => {
		if (arg == '--devsandbox') {
			sandbox = 'dev'
		} else if (arg == '--pilotsandbox') {
			sandbox = 'pilot'
		} else if (arg == '--subsumed') {
			subsumed = true
		}
	})

	cachedArgs.forEach(arg => {
		if (arg == '--install') {
			gotoPage('install', () => {})
			cancelInit = true
			return
		} else if (arg == '--uninstall') {
			uninstall()
			cancelInit = true
			return
		} else if (arg.startsWith('--updater')) {
			var updaterVersion = arg.split('=').pop()
			migrateLauncherTemp(updaterVersion)
			cancelInit = true
			return
		}
	})

	if (cancelInit)
		return

	if (!foundUri) {
		if (!checkSelfMigrated()) {
			gotoPage('install', () => {})
		} else {
			gotoPage('browse-worlds', () => {})
		}
		return
	}
	
	gotoPage('loading', () => {
		updateThenPlay()
	})
}