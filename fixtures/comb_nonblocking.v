module comb_nonblocking (
    input  wire [3:0] a,
    input  wire [3:0] b,
    output reg  [3:0] sum
);

    // Flaw: Non-blocking assignment '<=' inside combinational always block
    always @* begin
        sum <= a + b;
    end

endmodule
