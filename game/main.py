# Tic-Tac-Toe Game - Enhanced with Score Tracking and Difficulty
# Main entry point

from board import Board
from player import Player, HumanPlayer, AIPlayer
from score import ScoreBoard

def print_menu():
    print("\n=== Tic-Tac-Toe ===")
    print("1. PvP (Player vs Player)")
    print("2. PvE Easy")
    print("3. PvE Medium")
    print("4. PvE Hard (Unbeatable)")
    print("5. View Scores")
    print("6. Reset Scores")
    print("7. Exit")

def main():
    scoreboard = ScoreBoard()
    
    while True:
        print_menu()
        choice = input("\nSelect option (1-7): ").strip()
        
        if choice == "7":
            print("Thanks for playing!")
            break
        
        if choice == "5":
            scoreboard.print_scores()
            continue
        
        if choice == "6":
            scoreboard.reset()
            continue
        
        if choice not in ("1", "2", "3", "4"):
            print("Invalid option!")
            continue
        
        # Setup players
        if choice == "1":
            player1 = HumanPlayer("X")
            player2 = HumanPlayer("O")
            game_mode = "PvP"
        elif choice == "2":
            player1 = HumanPlayer("X")
            player2 = AIPlayer("O", "easy")
            game_mode = "PvE Easy"
        elif choice == "3":
            player1 = HumanPlayer("X")
            player2 = AIPlayer("O", "medium")
            game_mode = "PvE Medium"
        else:
            player1 = HumanPlayer("X")
            player2 = AIPlayer("O", "hard")
            game_mode = "PvE Hard"
        
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
                    if choice != "1":  # PvE
                        winner = "You" if current_player.symbol == "X" else "AI"
                        print(f"{winner} wins!")
                    else:
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
