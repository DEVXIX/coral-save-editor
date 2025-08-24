import { computed, Injectable, Signal, signal } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class SaveGameService {
  readonly status = signal<'NOT_STARTED' | 'PROCESSING' | 'SUCCESS' | 'ERROR' | 'EXPORTING'>('NOT_STARTED');
  readonly decodedData = signal<undefined | null | Record<string, any>>(null);
  readonly #rawData = signal<null | { name: string; content: ArrayBuffer }>(null);

  async parseSaveGame(saveFile: File) {
    const reader = new FileReader();
    reader.addEventListener('loadend', async (event) => {
      try {
        const target = event.target?.result as ArrayBuffer | undefined;
        if (target) {
          this.#rawData.set({ content: target, name: saveFile.name });
          console.log('Loading WASM module...');
          
          // Dynamically import the WASM module
          const wasmModule = await import('@coral/save-parser');
          console.log('WASM module loaded:', wasmModule);
          
          console.log('Calling decode_save with ArrayBuffer of length:', target.byteLength);
          const binarySave = wasmModule.decode_save(target);
          console.log('decode_save result:', binarySave);
          
          // Determine save data key (saveData_0 vs SaveData_0)
          const saveDataKey = binarySave?.root?.properties?.saveData_0 ? 'saveData_0' : 'SaveData_0';
          const saveDataRoot = binarySave?.root?.properties?.[saveDataKey];
          
          // Debug: Log player structure to see all available fields
          const playersPath = 'root.properties.SaveData_0.Struct.value.Struct.players_0.Array.value.Struct.value';
          const normalizedPlayersPath = playersPath.includes('SaveData_0') && saveDataKey === 'saveData_0'
            ? playersPath.replace('SaveData_0', 'saveData_0')
            : playersPath;
          
          const players = normalizedPlayersPath.split('.').reduce((a, b) => a?.[b], binarySave);
          if (players && Array.isArray(players) && players.length > 0) {
            console.log('First player structure:', JSON.stringify(players[0], null, 2));
            
            // Look for Steam ID and platform info in player data
            const firstPlayer = players[0];
            if (firstPlayer?.Struct?.value?.Struct) {
              const playerStruct = firstPlayer.Struct.value.Struct;
              console.log('Player struct keys:', Object.keys(playerStruct));
              
              // Look for any ID-related fields
              Object.keys(playerStruct).forEach(key => {
                if (key.toLowerCase().includes('id') || key.toLowerCase().includes('steam') || key.toLowerCase().includes('platform')) {
                  console.log(`Found potential ID field: ${key}`, playerStruct[key]);
                }
              });
            }
          }
          
          // Also check multiplayer config for Steam/platform info
          const multiplayerConfig = saveDataRoot?.Struct?.value?.Struct?.multiplayerConfig_0;
          if (multiplayerConfig) {
            console.log('Multiplayer config:', JSON.stringify(multiplayerConfig, null, 2));
          }
          
        this.decodedData.set(binarySave);
        console.log('Save game loaded successfully');
        this.status.set('SUCCESS');
        }
      } catch (e) {
        this.#rawData.set(null);
        this.status.set('ERROR');
        console.error('Error processing save file:', e);
      }
    });
    this.status.set('PROCESSING');
    reader.readAsArrayBuffer(saveFile);
  }

  get(path: string): Signal<any> {
    return computed(() => {
      const data = this.decodedData();
      if (!data) return undefined;
      
      // Handle different save data key formats (saveData_0 vs SaveData_0)
      let normalizedPath = path;
      if (path.includes('SaveData_0') && data['root']?.['properties']?.['saveData_0'] && !data['root']?.['properties']?.['SaveData_0']) {
        normalizedPath = path.replace('SaveData_0', 'saveData_0');
        console.log(`Normalized path from ${path} to ${normalizedPath}`);
      }
      
      const result = normalizedPath.split('.').reduce((a, b) => a?.[b], data);
      if (result === undefined) {
        console.warn(`Path not found: ${normalizedPath}`);
      }
      return result;
    });
  }

  set(desc: string, value: any) {
    let obj = this.decodedData();
    let arr = desc ? desc.split('.') : [];

    while (arr.length && obj) {
      let comp = arr.shift()!;
      let match = new RegExp('(.+)\\[([0-9]*)\\]').exec(comp);

      // handle arrays
      if (match !== null && match.length == 3) {
        let arrayData = {
          arrName: match[1],
          arrIndex: match[2],
        };
        if (obj[arrayData.arrName] !== undefined) {
          if (typeof value !== 'undefined' && arr.length === 0) {
            obj[arrayData.arrName][arrayData.arrIndex] = value;
          }
          obj = obj[arrayData.arrName][arrayData.arrIndex];
        } else {
          obj = undefined;
        }

        continue;
      }

      // handle regular things
      if (typeof value !== 'undefined') {
        if (obj[comp] === undefined) {
          obj[comp] = {};
        }

        if (arr.length === 0) {
          obj[comp] = value;
        }
      }

      obj = obj[comp];
    }

    return obj;
  }

  async save() {
    const rawData = this.#rawData();

    if (rawData) {
      try {
        // Dynamically import the WASM module
        const wasmModule = await import('@coral/save-parser');
        const fileData = wasmModule.encode_save(rawData.content, this.decodedData());
        this.#downloadBlob(fileData, rawData.name, 'application/octet-stream');
      } catch (e) {
        console.error('Error encoding save file:', e);
        this.status.set('ERROR');
      }
    }
  }

  movePlayer(fromIndex: number, toIndex: number): boolean {
    const data = this.decodedData();
    if (!data) return false;
    
    // Handle path normalization for different save formats
    let playersPath = 'root.properties.SaveData_0.Struct.value.Struct.players_0.Array.value.Struct.value';
    if (data['root']?.['properties']?.['saveData_0'] && !data['root']?.['properties']?.['SaveData_0']) {
      playersPath = 'root.properties.saveData_0.Struct.value.Struct.players_0.Array.value.Struct.value';
    }
    
    const players = this.get(playersPath)();
    
    if (players && Array.isArray(players) && 
        fromIndex >= 0 && fromIndex < players.length &&
        toIndex >= 0 && toIndex < players.length &&
        fromIndex !== toIndex) {
      
      // Swap the players
      const temp = players[fromIndex];
      players[fromIndex] = players[toIndex];
      players[toIndex] = temp;
      
      // Update the reactive signal
      this.decodedData.set({ ...this.decodedData() });
      return true;
    }
    
    return false;
  }

  removePlayer(playerIndex: number): boolean {
    const data = this.decodedData();
    if (!data) return false;
    
    // Handle path normalization for different save formats
    let playersPath = 'root.properties.SaveData_0.Struct.value.Struct.players_0.Array.value.Struct.value';
    if (data['root']?.['properties']?.['saveData_0'] && !data['root']?.['properties']?.['SaveData_0']) {
      playersPath = 'root.properties.saveData_0.Struct.value.Struct.players_0.Array.value.Struct.value';
    }
    
    const players = this.get(playersPath)();
    
    if (players && Array.isArray(players) && playerIndex >= 0 && playerIndex < players.length) {
      players.splice(playerIndex, 1);
      console.log(`Removed player at index ${playerIndex}`);
      
      // Update the decodedData signal to trigger reactivity
      this.decodedData.set({ ...this.decodedData() });
      return true;
    } else {
      console.warn(`Cannot remove player at index ${playerIndex}: invalid index or no players array`);
      return false;
    }
  }

  clearAllPlayers() {
    const data = this.decodedData();
    if (!data) return;
    
    // Handle path normalization for different save formats
    let playersPath = 'root.properties.SaveData_0.Struct.value.Struct.players_0.Array.value.Struct.value';
    if (data['root']?.['properties']?.['saveData_0'] && !data['root']?.['properties']?.['SaveData_0']) {
      playersPath = 'root.properties.saveData_0.Struct.value.Struct.players_0.Array.value.Struct.value';
    }
    
    const players = this.get(playersPath)();
    
    if (players && Array.isArray(players)) {
      players.length = 0; // Clear the array
      console.log('Cleared all players');
      
      // Update the decodedData signal to trigger reactivity
      this.decodedData.set({ ...this.decodedData() });
    } else {
      console.warn('Cannot clear players: no players array found');
    }
  }

  getPlayerData(playerIndex: number): unknown | null {
    const data = this.decodedData();
    if (!data) return null;
    
    // Handle path normalization for different save formats
    const saveDataKey = data['root']?.['properties']?.['saveData_0'] ? 'saveData_0' : 'SaveData_0';
    const playersPath = `root.properties.${saveDataKey}.Struct.value.Struct.players_0.Array.value.Struct.value`;
    
    const players = this.get(playersPath)();
    
    if (players && Array.isArray(players) && playerIndex >= 0 && playerIndex < players.length) {
      // Return the COMPLETE player data - this contains everything!
      // The player object already contains all their progression, items, world data, etc.
      return JSON.parse(JSON.stringify(players[playerIndex]));
    }
    
    return null;
  }

  getAllPlayersData(): unknown[] | null {
    const data = this.decodedData();
    if (!data) return null;
    
    // Handle path normalization for different save formats
    let playersPath = 'root.properties.SaveData_0.Struct.value.Struct.players_0.Array.value.Struct.value';
    if (data['root']?.['properties']?.['saveData_0'] && !data['root']?.['properties']?.['SaveData_0']) {
      playersPath = 'root.properties.saveData_0.Struct.value.Struct.players_0.Array.value.Struct.value';
    }
    
    const players = this.get(playersPath)();
    
    if (players && Array.isArray(players)) {
      return JSON.parse(JSON.stringify(players)); // Deep clone
    }
    
    return null;
  }

  importPlayerData(playerData: unknown, playerIndex?: number): boolean {
    const data = this.decodedData();
    if (!data) return false;
    
    // Handle path normalization for different save formats
    const saveDataKey = data['root']?.['properties']?.['saveData_0'] ? 'saveData_0' : 'SaveData_0';
    const playersPath = `root.properties.${saveDataKey}.Struct.value.Struct.players_0.Array.value.Struct.value`;
    
    const players = this.get(playersPath)();
    
    if (players && Array.isArray(players)) {
      if (typeof playerIndex === 'number' && playerIndex >= 0 && playerIndex < players.length) {
        // Replace existing player COMPLETELY with all their data
        players[playerIndex] = JSON.parse(JSON.stringify(playerData));
        console.log(`Completely replaced player at index ${playerIndex} with imported data`);
      } else {
        // Add as new player
        players.push(JSON.parse(JSON.stringify(playerData)));
        console.log('Added new player from imported data');
      }
      
      // Update the decodedData signal to trigger reactivity
      this.decodedData.set({ ...this.decodedData() });
      return true;
    }
    
    return false;
  }

  importAllPlayersData(playersData: unknown[]): boolean {
    const data = this.decodedData();
    if (!data) return false;
    
    // Handle path normalization for different save formats
    let playersPath = 'root.properties.SaveData_0.Struct.value.Struct.players_0.Array.value.Struct.value';
    if (data['root']?.['properties']?.['saveData_0'] && !data['root']?.['properties']?.['SaveData_0']) {
      playersPath = 'root.properties.saveData_0.Struct.value.Struct.players_0.Array.value.Struct.value';
    }
    
    const players = this.get(playersPath)();
    
    if (players && Array.isArray(players)) {
      // Replace all players
      players.length = 0;
      players.push(...playersData);
      console.log(`Imported ${playersData.length} players`);
      
      // Update the decodedData signal to trigger reactivity
      this.decodedData.set({ ...this.decodedData() });
      return true;
    }
    
    return false;
  }

  updatePlayerSteamId(playerIndex: number, newSteamId: string): boolean {
    const data = this.decodedData();
    if (!data) return false;
    
    // Handle path normalization for different save formats
    const saveDataKey = data['root']?.['properties']?.['saveData_0'] ? 'saveData_0' : 'SaveData_0';
    const playersPath = `root.properties.${saveDataKey}.Struct.value.Struct.players_0.Array.value.Struct.value`;
    
    const players = this.get(playersPath)();
    
    if (players && Array.isArray(players) && playerIndex >= 0 && playerIndex < players.length) {
      const player = players[playerIndex];
      
      // Update the Steam ID in the creatorUniqueId field
      if (player?.['Struct']?.['creatorUniqueId_0']?.['Struct']?.['value']?.['UniqueNetIdRepl']?.['inner']) {
        const inner = player['Struct']['creatorUniqueId_0']['Struct']['value']['UniqueNetIdRepl']['inner'];
        
        // Extract the current format and replace just the Steam ID part
        const currentContents = inner['contents'] || '';
        
        // Steam ID format is usually: "STEAMID_+_|UNIQUEPART"
        // We want to replace just the STEAMID part
        const parts = currentContents.split('_+_|');
        if (parts.length === 2) {
          // Keep the unique part, replace Steam ID
          inner['contents'] = `${newSteamId}_+_|${parts[1]}`;
        } else {
          // Fallback: replace entire contents
          inner['contents'] = newSteamId;
        }
        
        console.log(`Updated player ${playerIndex} Steam ID to: ${newSteamId}`);
        
        // Update the decodedData signal to trigger reactivity
        this.decodedData.set({ ...this.decodedData() });
        return true;
      }
    }
    
    return false;
  }

  getPlayerSteamId(playerIndex: number): string | null {
    const data = this.decodedData();
    if (!data) return null;
    
    // Handle path normalization for different save formats
    const saveDataKey = data['root']?.['properties']?.['saveData_0'] ? 'saveData_0' : 'SaveData_0';
    const playersPath = `root.properties.${saveDataKey}.Struct.value.Struct.players_0.Array.value.Struct.value`;
    
    const players = this.get(playersPath)();
    
    if (players && Array.isArray(players) && playerIndex >= 0 && playerIndex < players.length) {
      const player = players[playerIndex];
      
      // Get the Steam ID from the creatorUniqueId field
      const steamIdData = player?.['Struct']?.['creatorUniqueId_0']?.['Struct']?.['value']?.['UniqueNetIdRepl']?.['inner'];
      if (steamIdData) {
        return steamIdData['contents'] || null;
      }
    }
    
    return null;
  }

  #downloadURL(url: string, fileName: string) {
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.style.display = 'none';
    a.click();
    a.remove();
  }

  #downloadBlob(data: Uint8Array, fileName: string, mimeType: string) {
    const blob = new Blob([new Uint8Array(data)], {
      type: mimeType,
    });

    const url = window.URL.createObjectURL(blob);

    this.#downloadURL(url, fileName);

    setTimeout(() => window.URL.revokeObjectURL(url), 1000);
  }
}
