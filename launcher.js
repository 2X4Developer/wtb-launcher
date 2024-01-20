'use strict'

const { remote, ipcRenderer } = require('electron');

window.addEventListener('DOMContentLoaded', () => {

    ipcRenderer.on('alert', (event, message) => {
		alert(message)
	})

    var installBtn = document.getElementById('installbtn')
    if (installBtn) {
        installBtn.addEventListener('click', () => {
            ipcRenderer.send('install')
        })
    }

    var uninstallBtn = document.getElementById('uninstallbtn')
    if (uninstallBtn) {
        uninstallBtn.addEventListener('click', () => {
            ipcRenderer.send('uninstall')
        })
    }

    var tosNextBtn = document.getElementById('tosnextbtn')
    if (tosNextBtn) {
        tosNextBtn.addEventListener('click', () => {
            ipcRenderer.send('tosnext')
        })
    }

    var installCloseBtn = document.getElementById('installclosebtn')
    if (installCloseBtn) {
        installCloseBtn.addEventListener('click', () => {
            ipcRenderer.send('close')
        })
    }

    var uninstallCloseBtn = document.getElementById('uninstallclosebtn')
    if (uninstallCloseBtn) {
        uninstallCloseBtn.addEventListener('click', () => {
            ipcRenderer.send('close')
        })
    }

    var browseWorldsCloseBtn = document.getElementById('browseworldsclosebtn')
    if (browseWorldsCloseBtn) {
        browseWorldsCloseBtn.addEventListener('click', () => {
            ipcRenderer.send('close')
        })
    }

    var installPlayBtn = document.getElementById('installplaybtn')
    if (installPlayBtn) {
        installPlayBtn.addEventListener('click', () => {
            ipcRenderer.send('browseworlds')
        })
    }

    var browseWorldsBtn = document.getElementById('browseworldsbtn')
    if (browseWorldsBtn) {
        browseWorldsBtn.addEventListener('click', () => {
            ipcRenderer.send('browseworlds')
        })
    }

    var tosCheckOffBtn = document.getElementById('toscheckbtnoff')
    if (tosCheckOffBtn) {
        tosCheckOffBtn.addEventListener('click', () => {
            setTosCheck(false)
        })
    }

    var tosCheckOnBtn = document.getElementById('toscheckbtnon')
    if (tosCheckOnBtn) {
        tosCheckOnBtn.addEventListener('click', () => {
            setTosCheck(true)
        })
    }

    function setTosCheck(on) {
        if (on) {
            tosCheckOnBtn.style.display = 'none'
            tosCheckOffBtn.style.display = 'inline-block'
            tosNextBtn.disabled = false
        } else {
            tosCheckOnBtn.style.display = 'inline-block'
            tosCheckOffBtn.style.display = 'none'
            tosNextBtn.disabled = true
        }
    }
    setTosCheck(false)

    var fadeOverlay = document.getElementById('fadeoverlay')

    function fadeIn() {
        if (fadeOverlay) {
            fadeOverlay.style.opacity = '0.0'
        }
    }

    function fadeOut() {
        if (fadeOverlay) {
            fadeOverlay.style.opacity = '1.0'
        }
    }

    function callPageLoaded() {
        fadeOverlay.style.pointerEvents = 'all'
        fadeIn()
        setTimeout(() => {
            fadeOverlay.style.pointerEvents = 'none'
        }, 250)

        var pageElements = document.getElementsByClassName('page')
        if (pageElements) {
            for (var i = 0; i < pageElements.length; i++) {
                if (pageElements[i].style.display != 'none') {
                    const pageName = pageElements[i].id.substr(5)
                    ipcRenderer.send('pageLoaded', pageName)

                    return
                }
            }
        }
    }

    ipcRenderer.on('gotoPage', (event, page) => {
        var destinationPageElement = document.getElementById('page-' + page)
        if (destinationPageElement) {

            fadeOverlay.style.pointerEvents = 'all'
            fadeOut()

            setTimeout(() => {
                fadeOverlay.style.pointerEvents = 'none'

                var pageElements = document.getElementsByClassName('page')
                if (pageElements) {
                    for (var i = 0; i < pageElements.length; i++) {
                        pageElements[i].style.display = 'none'
                    }
                }
                destinationPageElement.style.display = 'block'
                callPageLoaded()
            }, 250)
        }
    })

    ipcRenderer.on('setLoadingBarProgress', (event, progress) => {
        var progressInt = Math.floor(progress)
        var loadingBar = document.getElementById('loadingbar')
        if (loadingBar) {
            loadingBar.style.width = progressInt + "%"
        }
        var loadingBarProgress = document.getElementById('loadingbarprogress')
        if (loadingBarProgress) {
            loadingBarProgress.innerHTML = progressInt + "%";
        }
    })

    ipcRenderer.on('setLoadingBarSubtext', (event, message) => {
        var loadingBarSubtext = document.getElementById('loadingbarsubtext')
        if (loadingBarSubtext) {
            loadingBarSubtext.innerHTML = message;
        }
    })

    ipcRenderer.on('setOutput', (event, message) => {
        var output = document.getElementById('output')
        if (output) {
            output.innerHTML = message;
        }
    })

    // set watermark content
    ipcRenderer.on('setWatermark', (event, content) => {
        var watermarks = document.getElementsByClassName('watermark')
        if (watermarks) {
            for (var i = 0; i < watermarks.length; i++) {
                watermarks[i].innerHTML = content
            }
        }
    })
})
