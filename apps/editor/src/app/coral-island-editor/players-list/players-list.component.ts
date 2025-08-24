import { Component, inject, Signal } from '@angular/core';
import { SaveGameService } from '../../core/save-game/save-game.service';
import { PrimitiveFormPartComponent } from '../../form-parts/primitive-form-part/primitive-form-part.component';
import { SaveGameValuePipe } from '../../core/save-game/save-game-value.pipe';
import { MoneyComponent } from '@coral-island/ui';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-players-list',
  standalone: true,
  imports: [PrimitiveFormPartComponent, SaveGameValuePipe, MoneyComponent, RouterLink, RouterLinkActive, CommonModule, FormsModule],
  templateUrl: './players-list.component.html',
})
export class PlayersListComponent {
  protected PLAYERS_ARRAY_PATH = 'root.properties.SaveData_0.Struct.value.Struct.players_0.Array.value.Struct.value';
  #saveGameService = inject(SaveGameService);

  players = this.#saveGameService.get(this.PLAYERS_ARRAY_PATH) as Signal<unknown[]>;
  
  showPlayerData: { [index: number]: boolean } = {};
  viewingPlayerData: { [index: number]: unknown } = {};
  editingSteamId: { [index: number]: boolean } = {};
  steamIdInputs: { [index: number]: string } = {};

  removePlayer(index: number, event: Event) {
    event.preventDefault();
    event.stopPropagation();
    
    if (confirm('Are you sure you want to remove this player? This action cannot be undone.')) {
      this.#saveGameService.removePlayer(index);
    }
  }

  clearAllPlayers(event: Event) {
    event.preventDefault();
    
    if (confirm('Are you sure you want to remove ALL players? This action cannot be undone.')) {
      this.#saveGameService.clearAllPlayers();
    }
  }

  viewPlayerData(index: number, event: Event) {
    event.preventDefault();
    event.stopPropagation();
    
    const playerData = this.#saveGameService.getPlayerData(index);
    if (playerData) {
      this.viewingPlayerData[index] = playerData;
      this.showPlayerData[index] = !this.showPlayerData[index];
    }
  }

  exportPlayerData(index: number, event: Event) {
    event.preventDefault();
    event.stopPropagation();
    
    const playerData = this.#saveGameService.getPlayerData(index);
    if (playerData) {
      const playerName = this.getPlayerName(index) || `player_${index}`;
      const blob = new Blob([JSON.stringify(playerData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${playerName}_data.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  }

  exportAllPlayersData(event: Event) {
    event.preventDefault();
    
    const playersData = this.#saveGameService.getAllPlayersData();
    if (playersData && playersData.length > 0) {
      const blob = new Blob([JSON.stringify(playersData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'all_players_data.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  }

  importPlayerData(index: number, event: Event) {
    event.preventDefault();
    event.stopPropagation();
    
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    
    input.onchange = (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const playerData = JSON.parse(e.target?.result as string);
            if (confirm(`Are you sure you want to replace player ${this.getPlayerName(index) || index} with imported data?`)) {
              this.#saveGameService.importPlayerData(playerData, index);
            }
          } catch (error) {
            alert('Error parsing JSON file: ' + error);
          }
        };
        reader.readAsText(file);
      }
    };
    
    input.click();
  }

  importAllPlayersData(event: Event) {
    event.preventDefault();
    
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    
    input.onchange = (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const playersData = JSON.parse(e.target?.result as string);
            if (Array.isArray(playersData)) {
              if (confirm(`Are you sure you want to replace ALL players with imported data? This will import ${playersData.length} players.`)) {
                this.#saveGameService.importAllPlayersData(playersData);
              }
            } else {
              alert('Invalid file format. Expected an array of player data.');
            }
          } catch (error) {
            alert('Error parsing JSON file: ' + error);
          }
        };
        reader.readAsText(file);
      }
    };
    
    input.click();
  }

  addNewPlayer(event: Event) {
    event.preventDefault();
    
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    
    input.onchange = (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const playerData = JSON.parse(e.target?.result as string);
            if (confirm('Are you sure you want to add this player from imported data?')) {
              this.#saveGameService.importPlayerData(playerData);
            }
          } catch (error) {
            alert('Error parsing JSON file: ' + error);
          }
        };
        reader.readAsText(file);
      }
    };
    
    input.click();
  }

  movePlayerUp(index: number, event: Event) {
    event.preventDefault();
    event.stopPropagation();
    
    if (index > 0) {
      if (confirm(`Move ${this.getPlayerName(index) || `Player ${index}`} up in the list?`)) {
        this.#saveGameService.movePlayer(index, index - 1);
      }
    }
  }

  movePlayerDown(index: number, event: Event) {
    event.preventDefault();
    event.stopPropagation();
    
    const players = this.players();
    if (index < players.length - 1) {
      if (confirm(`Move ${this.getPlayerName(index) || `Player ${index}`} down in the list?`)) {
        this.#saveGameService.movePlayer(index, index + 1);
      }
    }
  }

  editSteamId(index: number, event: Event) {
    event.preventDefault();
    event.stopPropagation();
    
    // Get current Steam ID
    const currentSteamId = this.#saveGameService.getPlayerSteamId(index);
    if (currentSteamId) {
      this.steamIdInputs[index] = currentSteamId;
      this.editingSteamId[index] = true;
    }
  }

  updateSteamId(index: number, event: Event) {
    event.preventDefault();
    event.stopPropagation();
    
    const newSteamId = this.steamIdInputs[index];
    if (newSteamId && newSteamId.trim()) {
      if (confirm(`Are you sure you want to update the Steam ID for ${this.getPlayerName(index) || `Player ${index}`}?`)) {
        const success = this.#saveGameService.updatePlayerSteamId(index, newSteamId.trim());
        if (success) {
          this.editingSteamId[index] = false;
          alert('Steam ID updated successfully!');
        } else {
          alert('Failed to update Steam ID. Please try again.');
        }
      }
    }
  }

  cancelSteamIdEdit(index: number, event: Event) {
    event.preventDefault();
    event.stopPropagation();
    
    this.editingSteamId[index] = false;
    delete this.steamIdInputs[index];
  }

  getSteamId(index: number): string {
    return this.#saveGameService.getPlayerSteamId(index) || 'N/A';
  }

  private getPlayerName(index: number): string | null {
    const playerPath = this.PLAYERS_ARRAY_PATH + '.' + index + '.Struct.playerInfo_0.Struct.value.Struct.Name_0.Str';
    const nameSignal = this.#saveGameService.get(playerPath);
    return nameSignal() as string || null;
  }
}
