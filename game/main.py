# Tic-Tac-Toe Game - Enhanced with Score Tracking
# Main entry point

from board import Board
from player import Player, HumanPlayer, AIPlayer
from score import ScoreBoard

def print_menu():
    print("\n=== Tic-Tac-Toe ===")
    print("1. PvP (Player vs Player)")
    print("2. PvE (Player vs AI)")
    print("3. View Scores")
    print("4. Reset Scores")
    print("5. Exit")

def main():
    scoreboard = ScoreBoard()
    
    while True:
        print_menu()
        choice = input("\nSelect option (1-5): ").strip()
        
        if choice == "5":
            print("Thanks for playing!")
            break
        
        if choice == "3":
            scoreboard.print_scores()
            continue
        
        if choice == "4":
            scoreboard.reset()
            continue
        
        if choice not in ("1", "2"):
            print("Invalid option!")
            continue
        
        # Setup players
        if choice == "1":
            player1 = HumanPlayer("X")
            player2 = HumanPlayer("O")
            game_mode = "PvP"
        else:
            player1 = HumanPlayer("X")
            player2 = AIPlayer("O")
            game_mode = "PvE"
        
        # Play game
        board = Board()
        current_player = player1
        
        print(f"\n--- {game_mode} Game ---")
        board.print_board()
        
        while not board.is_full():
            print(f"\nPlayer {current_player.symbol}'s turn")
            move = current_player.get_move(board)
            
            if board.make_move(move, current_player.symbol):
                board.print_board()
                
                if board.check_winner(current_player.symbol):
                    print(f"Player {current_player.symbol} wins!")
                    scoreboard.add_win(current_player.symbol)
                    break
                
                if board.is_full():
                    print("It's a draw!")
                    scoreboard.add_draw()
                    break
            
            current_player = player2 if current_player == player1 else player1
        
        scoreboard.print_scores()

if __name__ == "__main__":
    main()
