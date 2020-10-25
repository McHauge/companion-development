/////////////////////////////////////////////////////////////
// Program functions
var audioCtx = null;
var audioScriptNode = [null, null, null, null];
channelsToLoad = 8;
videoEnabled = [0, 0, 0, 0];
audioEnabled = [0, 0, 0, 0];
audioPrecached = [0, 0, 0, 0];
var audioSource = [null, null, null, null];
audioMuted = [0, 0, 0, 0];
audioSamplesCh1 = [[]];
audioSamplesCh2 = [[]];
audioLevelCh1 = [[]];
audioLevelCh2 = [[]];
ignoreNextPacket = [];
streamUserSubscribed = [];
currentChannel = -1;
hasSignal = [];
isRecording = [];
isChannelAvailable = [];
lastRemoteStatus = [];
videoMode = [-1, -1, -1, -1]
hasWebLicense = false;
hasEdlLicense = false;
hasPresets = [];
languageArray = {};
streamPort = 0;
gangController = [];
gangControllerActive = [];

var g_video_modes=[

		"PAL",
		"NTSC",
		"HD_720p_50",
		"HD_720p_59_94",
		"HD_1080i_50",
		"HD_1080i_59_94",
		"HD_1080p_23_98",
		"HD_1080p_24",
		"HD_1080p_25",
		"HD_1080p_50",
		"HD_1080p_29_97",
		"HD_1080p_59_94",
		"HD_1080p_30",
		"HD_1080p_60",

		"UHD_4K_2160p_23_98",
		"UHD_4K_2160p_24",
		"UHD_4K_2160p_25",
		"UHD_4K_2160p_50",
		"UHD_4K_2160p_29_97",
		"UHD_4K_2160p_59_94",
		"UHD_4K_2160p_30",
		"UHD_4K_2160p_60"];
		
var audioCommitSamples = 2048;	// must be power of two
var audioSyncTime = [0, 0, 0, 0];
var audioPrecachedTime = [0, 0 ,0 ,0];

function setup() {
	//for (var i = 0; i < channelsToLoad; i++)
	setup_loadChannel(0);
	setup_audio();
}

function setup_loadChannel(channel) {
   //console.log("setup_loadChannel ... "+channel);
		
	sendAjaxRequest("GET", "channel.html", "", function(response) {
		
		response = response.replace(/__channelID__/g, channel);
		var container = getElemById("channel-container");
		container.innerHTML = container.innerHTML.concat(response);
		setup_onChannelLoaded(channel);
		
		if (channel == channelsToLoad - 1)
			setup_onChannelsLoaded();
		else
			setup_loadChannel(channel+1);
	});
}

function setup_onChannelLoaded(channel) {
	videoEnabled[channel] = false;
	audioEnabled[channel] = false;
	audioMuted[channel] = true;
	streamUserSubscribed[channel] = true;
	ignoreNextPacket[channel] = false;
	audioLevelCh1[channel] = [];
	audioLevelCh2[channel] = [];
	
	getChannelElem(channel, "channel-number").innerHTML = channel + 1;
	refreshMuteBtn(channel);
	
	deactivateChannel(channel);
}

function setup_onChannelsLoaded() {
	send_programStatus();
	
	switchToChannel(0);
	
	var layout = parseInt(getCookie("layout"));
	if (isNaN(layout) || layout < 0 || layout > 1)
		layout = 0;
	
	getElemById("layout-select").selectedIndex = layout;
	
	changeLayout();
}

function setup_audio() {
	if (window.AudioContext || window.webkitAudioContext)
		audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}

function start_audio(channel) {
	if (audioEnabled[channel])
		return;
	
	if (audioMuted[channel])
		return;
	
	if (!audioCtx)
		return;
	
	audioEnabled[channel] = true;
	audioPrecached[channel] = false;
	audioSamplesCh1[channel] = [];
	audioSamplesCh2[channel] = [];

	audioScriptNode[channel] = audioCtx.createScriptProcessor(audioCommitSamples, 1, 2);
	audioScriptNode[channel].connect(audioCtx.destination);
	audioScriptNode[channel].onaudioprocess = function(event) {
		if(!audioPrecached[channel]) {
			if(audioSamplesCh1[channel].length < (2 * audioCommitSamples))
				return;
			audioPrecached[channel] = true;
			audioSyncTime[channel] = audioSamplesCh1[channel].length / audioCtx.sampleRate;
		}

		var audioPrecachedTime = audioSamplesCh1[channel].length / audioCtx.sampleRate;
		if((audioPrecachedTime - audioSyncTime[channel]) > 0.15)	// re-sync
		{
			//console.log("Re-sync: ", audioPrecachedTime - audioSyncTime[channel]);
			var syncLen = audioSyncTime[channel] * audioCtx.sampleRate;
			audioSamplesCh1[channel].splice(0, audioSamplesCh1[channel].length - syncLen);
			audioSamplesCh2[channel].splice(0, audioSamplesCh2[channel].length - syncLen);
		}

		var buffer = event.outputBuffer;
		var minLen = Math.min(audioSamplesCh1[channel].length, buffer.length);
		
		var decodedCh1 = audioSamplesCh1[channel].splice(0,minLen);
		var bufferingCh1 = buffer.getChannelData(0);
		for(var i = 0; i < minLen; ++i) {
			bufferingCh1[i] = decodedCh1[i];
		}
		for(var i = minLen; i < buffer.length; ++i) {
			bufferingCh1[i] = 0;
		}

		var decodedCh2 = audioSamplesCh2[channel].splice(0, minLen);
		var bufferingCh2 = buffer.getChannelData(1);
		for(var i = 0; i < minLen; ++i) {
			bufferingCh2[i] = decodedCh2[i];
		}
		for(var i = minLen; i < buffer.length; ++i) {
			bufferingCh2[i] = 0;
		}
	}

	audioSource[channel] = audioCtx.createBufferSource();
	audioSource[channel].connect(audioScriptNode[channel]);

	audioSource[channel].start(0);
}

function stop_audio(channel) {
	if (!audioEnabled[channel])
		return;
	
	if (!audioCtx)
		return;

	audioEnabled[channel] = false;

	audioSource[channel].stop(0);
	audioSource[channel].disconnect(audioScriptNode[channel]);
	audioSource[channel] = null;

	audioScriptNode[channel].disconnect(audioCtx.destination);
	audioScriptNode[channel].onaudioprocess = null;
	audioScriptNode[channel] = null;
}

function toggleMuteAudio(channel) {
	if (audioMuted[channel]) {
		audioMuted[channel] = false;
		start_audio(channel);
	} else {
		audioMuted[channel] = true;
		stop_audio(channel);
	}
	
	refreshMuteBtn(channel);
}

function setup_stream(port) {
	var host = "ws://" + window.location.hostname + ":" + port;
	socket = new WebSocket(host);
	socket.onopen = function() {
		send_recordingStatusAll();
		setTimeout(update, 1000);
	}

	socket.onmessage = function(msg) {
		var jsonMsg = JSON.parse(msg.data);
		process_message(jsonMsg);
	}
	
	socket.onclose = function() {
		for(var i = 0; i < channelsToLoad; ++i)
		{
			onSignalLost(i);
			onChannelUnavailable(i, "Connection lost");
		}
	}
}

function switchToChannel(channel) {
	if (currentChannel >= 0)
		deactivateChannel(currentChannel);
	
	activateChannel(channel);
	currentChannel = channel;
}

function activateChannel(channel) {
	getChannelElem(channel, "channel").style.display = "inline-block";
	
	streamUserSubscribed[channel] = true;
	
	addElemClass(getChannelElem(channel, 'tab-btn'), "selected");
}

function deactivateChannel(channel) {
	getChannelElem(channel, "channel").style.display = "none";
	
	onSignalLost(channel);
	onChannelUnavailable(channel, "Channel disabled");
	
	removeElemClass(getChannelElem(channel, 'tab-btn'), "selected");
}

function isTabbedLayout() {
	return getElemById("layout-select").selectedIndex == 0;
}

function changeLayout() {
	if (isTabbedLayout()) {
		getElemById("channel-tabs").style.display = "block";
		
		getElemById("channel-container").style.width = "" + getElemById("header").clientWidth + "px";
		
		for (var i = 0; i < channelsToLoad; ++i) {
			if (i != currentChannel)
				deactivateChannel(i);
		}
	} else {
		
		getElemById("channel-tabs").style.display = "none";
		
		getElemById("channel-container").style.width = "";
		
		for (var i = 0; i < channelsToLoad; ++i) {
			if (i != currentChannel)
				activateChannel(i);
		}
	}
	
	setCookie("layout", getElemById("layout-select").selectedIndex);
}

function isChannelVisible(channel) {
	if (isTabbedLayout()) {
		return channel == currentChannel;
	} else {
		return true;
	}
}

function update() {
	if (socket.readyState == 3) {
		setup_stream(streamPort);
		return;
	}
	
	if (isTabbedLayout()) {
		if (currentChannel >= 0)
			send_recordingStatus(currentChannel);	
	} else {
		send_recordingStatusAll();
	}
	
	setTimeout(update, 500);
}

function setVumeterValue(channel, audio_chan, vumeter_value) {
	var ratio = Math.min(Math.max(0, vumeter_value / -36), 1);
	var elem = getChannelElem(channel, audio_chan == 0? "vumeter-line-ch1" : "vumeter-line-ch2");
	var height = elem.parentElement.clientHeight;
	var vumeterHeight = height * (1 - ratio);
	elem.style.height = "" + vumeterHeight + "px";
	elem.style.top = "" + (height - vumeterHeight) + "px";
	elem.getElementsByTagName("div")[0].style.top = "-" + (height - vumeterHeight) + "px";
}

function setTimeValue(channel, timeSeconds, timeElem) {
	if (timeSeconds < 0)
	{
		timeElem.innerHTML = "--:--:--";
		return;
	}
	
	var date = new Date(1000 * timeSeconds);
	var nValue = date.getUTCHours();
	timeElem.innerHTML = (nValue < 10? "0": "") + nValue;
	
	nValue = date.getUTCMinutes();
	timeElem.innerHTML += ":" + (nValue < 10? "0": "") + nValue;
	
	nValue = date.getUTCSeconds();
	timeElem.innerHTML += ":" + (nValue < 10? "0": "") + nValue;
}

function refreshMuteBtn(channel) {
	if (!audioCtx) {
		var elem = getChannelElem(channel, "btn-mute");
		elem.innerHTML = LOCAL("Audio disabled");
		elem.disabled = true;
	} else {
		if (audioMuted[channel])
			getChannelElem(channel, "btn-mute").innerHTML = LOCAL("Audio is OFF");
		else
		    getChannelElem(channel, "btn-mute").innerHTML = LOCAL("Audio is ON");
	}
}

function onSignalReceived(channel) {
	if (!videoEnabled[channel])
		send_streamSubscribe(channel);
	
	hasSignal[channel] = true;
}

function onSignalLost(channel) {
	if (videoEnabled[channel])
		send_streamUnsubscribe(channel);
	
	getChannelElem(channel, "preview").src = "no-input.png";
	
	hasSignal[channel] = false;
}

function onRecordingStarted(channel) {
	isRecording[channel] = true;
	
	updateControlsEnabled(channel);
}

function onRecordingStopped(channel) {
	isRecording[channel] = false;
	
	updateControlsEnabled(channel);
}

function onChannelAvailable(channel, reason) {
	getChannelElem(channel, "remote-status").innerHTML = reason;
	
	isChannelAvailable[channel] = true;
	
	updateControlsEnabled(channel);
}

function onChannelUnavailable(channel, reason) {
	if (!isChannelAvailable[channel] && lastRemoteStatus[channel] == reason)
		return;
	
	getChannelElem(channel, "remote-status").innerHTML = LOCAL(reason);
	
	lastRemoteStatus[channel] = reason;
	isChannelAvailable[channel] = false;
	
	onRecordingStopped(channel); //also calls updateControlsEnabled
}

function updateControlsEnabled(channel) {
	
	if (isRecording[channel])
		addElemClass(getChannelElem(channel, "rec-btn-rec"), "selected");
	else
		removeElemClass(getChannelElem(channel, "rec-btn-rec"), "selected");
	
	var isGangControlled = gangController[channel] >= 0 && gangControllerActive[channel];
	
	getChannelElem(channel, "rec-btn-rec").disabled = !hasPresets[channel] || !hasWebLicense || !isChannelAvailable[channel];
	getChannelElem(channel, "rec-btn-stop").disabled = !isRecording[channel] || !hasWebLicense || !isChannelAvailable[channel];
	getChannelElem(channel, "rec-btn-split").disabled = !isRecording[channel] || !hasWebLicense || !isChannelAvailable[channel];
	
	if (hasEdlLicense)
		getChannelElem(channel, "rec-btn-mark").style.display = "block";
	else
		getChannelElem(channel, "rec-btn-mark").style.display = "none";
	getChannelElem(channel, "rec-btn-mark").disabled = !isRecording[channel] || !hasWebLicense || !isChannelAvailable[channel];
	
	getChannelElem(channel, "video-hub").disabled = isRecording[channel] || !hasWebLicense || (!isChannelAvailable[channel] && !isGangControlled);
	getChannelElem(channel, "preset-0-select").disabled = isRecording[channel] || !hasWebLicense || !isChannelAvailable[channel];
	getChannelElem(channel, "preset-1-select").disabled = isRecording[channel] || !hasWebLicense || !isChannelAvailable[channel];
	getChannelElem(channel, "rec-name").disabled = isRecording[channel] || !hasWebLicense || !isChannelAvailable[channel];
	getChannelElem(channel, "btn-duration-5").disabled = !hasWebLicense || !isChannelAvailable[channel];
	
}

function setup_language(langFileUrl) {
	if (langFileUrl.indexOf("english.loc") >= 0) //don't load english localization
		return;
		
	sendAjaxRequest("GET", langFileUrl, "cache="+(new Date().getTime()), function(response) {
		languageArray = {};
		response.split('\r\n').map(function (line) {
			var tokens = line.split('\t');
			if (tokens.length == 2) {
				languageArray[tokens[0]] = tokens[1];
			}
		});
		
		var elems = document.getElementsByClassName("local");
		for (var i = 0; i < elems.length; ++i)
			elems[i].innerHTML = LOCAL(elems[i].innerHTML);
	});
}

/////////////////////////////////////////////////////////////
// Send message functions

function send_programStatus() {
	sendAjaxRequest("GET", "program/status", "");
}

function send_recordingStatusAll() {
	sendStreamRequest("GET", "recording/status", "");
}

function send_recordingStatus(channel) {
	sendStreamRequest("GET", "recording/status", "channel="+channel);
}

function send_streamSubscribe(channel, userEvent) {
	if (userEvent)
		streamUserSubscribed[channel] = true;
	
	if (!streamUserSubscribed[channel])
		return;
	
	videoEnabled[channel] = 1;
	sendStreamRequest("POST", "stream/subscribe", "channel=" + channel + "&sample_rate=" + (audioCtx? audioCtx.sampleRate : 44100));
	
	start_audio(channel);
}

function send_streamUnsubscribe(channel, userEvent) {
	if (userEvent)
		streamUserSubscribed[channel] = false;
	
	videoEnabled[channel] = 0;
	sendStreamRequest("POST", "stream/unsubscribe", "channel=" + channel);
	
	stop_audio(channel);
}

function send_recordingRec(channel) {
	if (isRecording[channel])
		return;
	
	var recName = getChannelElem(channel, "rec-name").value;
	sendStreamRequest("POST", "recording/rec", "channel=" + channel + "&recname=" + recName);
	
	ignoreNextPacket[channel] = true;
	
	onRecordingStarted(channel);
}

function send_recordingStop(channel) {
	if (!isRecording[channel])
		return;
	
	getChannelElem(channel, "rec-name").value = "";
	sendStreamRequest("POST", "recording/stop", "channel=" + channel);
	
	ignoreNextPacket[channel] = true;
	
	onRecordingStopped(channel);
}

function send_recordingSplit(channel) {
	if (!isRecording[channel])
		return;
	
	sendStreamRequest("POST", "recording/split", "channel=" + channel);
}

function send_recordingMark(channel) {
	if (!isRecording[channel])
		return;
	
	sendStreamRequest("POST", "recording/mark", "channel=" + channel);
}

function send_recordingPreset(channel, encoder) {
	var elemName = "preset-" + encoder + "-select";
	var elem = getChannelElem(channel, elemName);
	
	ignoreNextPacket[channel] = true;
	
	sendStreamRequest("POST", "recording/preset", "channel=" + channel + "&encoder=" + encoder + "&videomode=" + videoMode[channel] + "&preset=" + elem.selectedIndex);
}

function send_recordingTimeAdd(channel, minutes) {
	var seconds = minutes * 60;
	sendStreamRequest("POST", "recording/time/add", "channel=" + channel + "&time=" + seconds);
}

function send_videohubChange(channel) {
	var elem = getChannelElem(channel, "video-hub");
	
	ignoreNextPacket[channel] = true;
	
	sendStreamRequest("POST", "videohub/change", "channel=" + channel + "&index=" + elem.selectedIndex);
}

/////////////////////////////////////////////////////////////
// Process message functions

function process_message(msg) {
	if (msg.request_url == "program/status")
		process_programStatus(msg);
	
	if (msg.request_url == "recording/status")
		process_statusRequest(msg);
	
	if (msg.request_url == "stream/package")
		process_streamPackage(msg);
}

function process_programStatus(msg) {
	hasWebLicense = msg.license_web;
	hasEdlLicense = msg.license_edl;
	streamPort = msg.stream_port;
	setup_stream(msg.stream_port);
	
	if (!hasWebLicense) {
		for (var i = 0; i < channelsToLoad; ++i) {
			onChannelUnavailable(i, "No web license!");
		}
	}
	
	setup_language(msg.language.url);
}

function process_statusRequest(msg) {
	if (msg.status.constructor === Array) {
		for (var i = 0; i < 8; ++i) {
			processChannelStatus(i, msg.status[i]);
		}	
	}
	else{
		processChannelStatus(msg.channel, msg.status);	
	}
}

function processChannelStatus(channel, status) {
	if (ignoreNextPacket[channel])
	{
		ignoreNextPacket[channel] = false;
		return;
	}
	
	var updateControls = false;
	
	if (gangController[channel] != status.master_channel || gangControllerActive[channel] != status.master_channel_active)
		updateControls = true;
	
	gangController[channel] = status.master_channel;
	gangControllerActive[channel] = status.master_channel_active;
	
	if (status.forbidden) {
		onChannelUnavailable(channel, "Channel forbidden");
	} else if (!hasWebLicense) {
		onChannelUnavailable(channel, "No web license!");
	} else if (status.remote && status.controller && status.controller.length > 0) {
		onChannelUnavailable(channel, LOCAL("Controlled by") + " " + status.controller);
	} else if (status.master_channel >= 0) {
		onChannelUnavailable(channel, LOCAL("Controlled by channel") + " " + (status.master_channel + 1));
	} else {
		if (isChannelVisible(channel) && status.enabled && status.remote) {
			if (!isChannelAvailable[channel])
				onChannelAvailable(channel, LOCAL("Control enabled"));
		} else {
			var statusText = "Channel disabled";
			if (!status.enabled)
				statusText = "Channel disabled";
			else if (!status.remote)
				statusText = "Control disabled";
		
			if (isChannelAvailable[channel] || lastRemoteStatus[channel] != statusText)
				onChannelUnavailable(channel, statusText);
		}
	}
	
	if (updateControls)
		updateControlsEnabled(channel);
	
	if (isChannelVisible(channel) && !status.forbidden && status.enabled && status.video_mode >= 0) {
		if (!hasSignal[channel])
			onSignalReceived(channel);
	}
	else if (hasSignal[channel]){
		onSignalLost(channel);
	}
	
	if (status.forbidden)
		return;
		
	getChannelElem(channel, "tab-btn").innerHTML = status.name;
	
	if (status.video_mode < 0)
		getChannelElem(channel, "video-mode").innerHTML = LOCAL("No source");
	else
		getChannelElem(channel, "video-mode").innerHTML = getVideoModeName(status.video_mode);
	
	videoMode[channel] = status.video_mode;
	
	var hasPresetsNew = status.presets.length > 0;
	if (hasPresets[channel] != hasPresetsNew) {
		hasPresets[channel] = hasPresetsNew;
		updateControlsEnabled(channel);
	}
	for (var i = 0; i < 2; ++i) {
		var selectId = "preset-"+i+"-select";
		var selectElem = getChannelElem(channel, selectId);

		var sameContent = 0;
		if(selectElem.length == status.presets.length) {
			sameContent = 1;
			for(var j = 0; j < selectElem.length; ++j) {
				if(selectElem[j].text != status.presets[j]) {
					sameContent = 0;
					break;
				}
			}
		} else if(status.presets.length == 0 && selectElem.length == 1) {
			 sameContent = (selectElem[0].text == "-- No preset selected --");
		} else if(i == 1 && selectElem.length == (status.presets.length + 1)) {
			sameContent = 1;
			for(var j = 0; j < status.presets.length; ++j) {
				if(selectElem[j + 1].text != status.presets[j]) {
					sameContent = 0;
					break;
				}
			}
		}

		if(!sameContent)
		{
			while (selectElem.firstChild)
				selectElem.removeChild(selectElem.firstChild);	
			
			if (i != 0 || status.presets.length == 0)
				addSelectOption(selectElem, "-- No preset selected --", "");
			for (var j = 0; j < status.presets.length; ++j)
				addSelectOption(selectElem, status.presets[j], status.presets[j]);
		}

		var add = 0;
		if (i != 0 || status.presets.length == 0)
			add = 1;
		
		selectElem.selectedIndex = status.selected_preset[i] + add;
	}
	
	setTimeValue(channel, status.time_elapsed, getChannelElem(channel, "rec-time-elapsed"));
	setTimeValue(channel, status.time_remaining, getChannelElem(channel, "rec-time-remaining"));
	
	if (isChannelVisible(channel) && status.recording) {
		if (!isRecording[channel])
			onRecordingStarted(channel);
	} else if (isRecording[channel])
		onRecordingStopped(channel);
	
	if (status.video_hub_channels.length == 0) {
		getChannelElem(channel, "video-hub").parentElement.style.display = "none";
	} else {
		var selectElem = getChannelElem(channel, "video-hub");

		var sameContent = 0;
		if(selectElem.length == status.video_hub_channels.length) {
			sameContent = 1;
			for(var j = 0; j < selectElem.length; ++j) {
				if(selectElem[j].text != status.video_hub_channels[j]) {
					sameContent = 0;
					break;
				}
			}
		}

		if(!sameContent)
		{
			selectElem.parentElement.style.display = "block";
				
			while (selectElem.firstChild)
				selectElem.removeChild(selectElem.firstChild);
				
			for (var j = 0; j < status.video_hub_channels.length; ++j)
				addSelectOption(selectElem, status.video_hub_channels[j], status.video_hub_channels[j]);
		}
		
		if (!selectElem.isMagicInit)
		{
			selectElem.addEventListener('change', function() {
				selectElem.magicSelectedIndex = selectElem.selectedIndex;
			})
			
			selectElem.magicSelectedIndex = selectElem.selectedIndex;
			selectElem.isMagicInit = true;
		}
		
		if (selectElem.magicSelectedIndex != status.video_hub_selected)
		{
			selectElem.selectedIndex = status.video_hub_selected;	
			selectElem.magicSelectedIndex = status.video_hub_selected;
		}
	}
	
	if (status.marks_count == 0) {
		getChannelElem(channel, "rec-btn-mark").innerHTML = LOCAL("MARK");
	} else {
		getChannelElem(channel, "rec-btn-mark").innerHTML = LOCAL("MARK") + " <br/>"+status.marks_count;
	}
}

function process_streamPackage(msg) {
	var channel = msg.channel;
	var data_video = msg.video;
	var data_audio_ch1 = msg.audio_ch1;
	var data_audio_ch2 = msg.audio_ch2;
	var audio_samples = msg.samples_count;
	var audio_level_ch1 = msg.audio_ch1_level;
	var audio_level_ch2 = msg.audio_ch2_level;

	if(data_video.length > 0)
	{
		var imgDiv = getChannelElem(channel, "preview");
		imgDiv.src = "data:image/png;base64," + data_video;
	}

	if(audio_samples > 0 && audioEnabled[channel])
	{
		decodeAudioSamples(data_audio_ch1, audio_samples, audioSamplesCh1[channel]);
		decodeAudioSamples(data_audio_ch2, audio_samples, audioSamplesCh2[channel]);
	}
	
	//update vumeters
	audioLevelCh1[channel].push(audio_level_ch1);
	if (audioLevelCh1[channel].length > 5)
		audioLevelCh1[channel].splice(0, audioLevelCh1[channel].length - 5);
	
	var mediumValue = 0;
	for (var i = 0; i < audioLevelCh1[channel].length; ++i) {
		mediumValue += audioLevelCh1[channel][i];
	}
	mediumValue /= 5;
	
	setVumeterValue(channel, 0, mediumValue);
	
	audioLevelCh2[channel].push(audio_level_ch2);
	if (audioLevelCh2[channel].length > 5)
		audioLevelCh2[channel].splice(0, audioLevelCh2[channel].length - 5);
	
	mediumValue = 0;
	for (var i = 0; i < audioLevelCh2[channel].length; ++i) {
		mediumValue += audioLevelCh2[channel][i];
	}
	mediumValue /= 5;
	
	setVumeterValue(channel, 1, mediumValue);
}

/////////////////////////////////////////////////////////////
// Helper functions

function addElemClass(elem, class_) {
	elem.className = elem.className.replace(new RegExp("\\b" + class_ + "\\b"), '');
	elem.className = elem.className + " " + class_;
}

function removeElemClass(elem, class_) {
	elem.className = elem.className.replace(new RegExp("\\b" + class_ + "\\b"), '');
}

function addSelectOption(select, optionText, optionValue) {
	var option = document.createElement("option");
	option.text = LOCAL(optionText);
	option.value = optionValue;
	addElemClass(option, "local");
	select.add(option);
}

function getElemById(id) {
	return document.getElementById(id);
}

function getChannelElem(channel, id) {
	return getElemById(id + "-" + channel);
}

function getUrl(restUrl) {
	return window.location.protocol + "//" + window.location.host + "/" + restUrl;
}

function decodeAudioSamples(base64, samplesCount, out_array) {
	base64 = base64.replace(/\s/g, '');
	var binary_string = window.atob(base64);               // take base64 input and convert it to  binary data
    var len = binary_string.length;
    for (var i = 0; i < len; i+=2)        {
        var byte1 = binary_string.charCodeAt(i);
        var byte2 = binary_string.charCodeAt(i+1);
        var word = byte2<<8 | byte1;                        // input raw data is Signed Int Big endian
        if(word <= 0x7FFF)
        	out_array.push(word / 32767.0);                 // scale it to float32 [-1; 1]
        else                                                // if  bit 31 == 1 -> negative number
        	out_array.push((word - 0xFFFF - 1) / 32767.0);  // get the negative value from the positive word (and then scale it to float32 [-1; 1])
    }
}

function sendStreamRequest(verb, url, params) {
	if (socket.readyState === 1)
	{
		params = encodeURIComponent(params);
		socket.send(verb + " " + url + "?" + params);
	}
}

function sendAjaxRequest(verb, url, params, onSuccess, onFail) {
	var req = createAjaxRequest(onSuccess, onFail);
	params = encodeURIComponent(params);
	
	if (verb == "GET")
		url += "?" + params;
	
	req.open(verb, getUrl(url), true);
	
	if (verb == "GET") {
		req.send();
	}
	else if (verb == "POST"){
		req.setRequestHeader("Content-type","application/x-www-form-urlencoded");
		req.send(params);
	}
}

function createAjaxRequest(onSuccess, onFail) {
	var result = null;
	if (window.XMLHttpRequest) // FireFox, Safari, etc.
		result = new XMLHttpRequest();
	else if (window.ActiveXObject) // MSIE
		result = new ActiveXObject("Microsoft.XMLHTTP");

	if (result == null)
		return;
	
	result.onreadystatechange = function() {
		if (result.readyState != 4)
			return;
		
		if (result.status != 200)
		{
			if (onFail)
				onFail(result.responseText);
			return;
		}
		
		if (onSuccess)
			onSuccess(result.responseText);
		else
			process_message(JSON.parse(result.responseText));
	}
	
	return result;
}

		
function getVideoModeName(video_mode) {
	if(video_mode>=0 &&  video_mode<g_video_modes.length)
		return g_video_modes[video_mode];
	return "Unknown";
}

function LOCAL(text) {
	if (text in languageArray)
		return languageArray[text];
	
	return text;
}

function setCookie(cname, cvalue, exdays) {
    var d = new Date();
    d.setTime(d.getTime() + (exdays*24*60*60*1000));
    var expires = "expires="+d.toUTCString();
    document.cookie = cname + "=" + cvalue + "; " + expires;
}

function getCookie(cname) {
    var name = cname + "=";
    var ca = document.cookie.split(';');
    for(var i=0; i<ca.length; i++) {
        var c = ca[i];
        while (c.charAt(0)==' ') c = c.substring(1);
        if (c.indexOf(name) == 0) return c.substring(name.length, c.length);
    }
    return "";
}
